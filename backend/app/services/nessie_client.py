"""Nessie sandbox records. Payments are calculated locally, never bank quotes.

Only synthetic names plus the public BIN leave BlindSpot. A single customer and
merchant are reused, with one account / purchase / loan per building. GETs recover
records after an interrupted POST; mutations are never retried automatically.
"""

import asyncio
import hashlib
from datetime import date, datetime, timezone

import httpx

from app.config import get_settings
from app.services import store

_sync_lock = asyncio.Lock()
CUSTOMER_NAME = ("BlindSpot", "Simulation")
MERCHANT_NAME = "BlindSpot NYC - Fictional Shed Rental"


class NessieError(Exception):
    pass


class NessieClient:
    def __init__(self, client: httpx.AsyncClient, key: str):
        self.client = client
        self.key = key

    async def request(self, method: str, path: str, payload: dict | None = None):
        try:
            response = await self.client.request(method, path, params={"key": self.key}, json=payload)
        except httpx.HTTPError:
            # HTTP exception URLs contain the key; don't log or return them.
            raise NessieError("Nessie could not be reached. Your local calculation is still available.") from None
        if not response.is_success:
            raise NessieError(f"Nessie rejected the {method} request (HTTP {response.status_code}). Check the backend key and sandbox service.")
        if response.status_code == 204:
            return None
        try:
            body = response.json()
        except ValueError:
            raise NessieError("Nessie returned an unreadable response.") from None
        if isinstance(body, dict) and isinstance(body.get("code"), int) and body["code"] >= 400:
            raise NessieError(f"Nessie rejected the operation (code {body['code']}).")
        return body

    async def find_or_create(self, path: str, payload: dict, matches) -> str:
        rows = await self.request("GET", path)
        if not isinstance(rows, list):
            raise NessieError("Nessie returned an unexpected list response.")
        for row in rows:
            if isinstance(row, dict) and matches(row) and row.get("_id"):
                return str(row["_id"])
        body = await self.request("POST", path, payload)
        created = body.get("objectCreated", {}) if isinstance(body, dict) else {}
        if not isinstance(created, dict) or not created.get("_id"):
            raise NessieError("Nessie did not return a created record ID. Retry to check whether it was saved.")
        return str(created["_id"])


def namespace() -> str:
    settings = get_settings()
    return hashlib.sha256((settings.nessie_api_url + settings.nessie_api_key).encode()).hexdigest()[:16]


async def cached_records(bin_id: str, assumptions: dict) -> dict | None:
    if not get_settings().nessie_api_key:
        return None
    doc = await store.get_finance_record(f"{namespace()}:building:{bin_id}")
    # Horizon doesn't affect the one-month purchase or the loan record.
    terms = {k: v for k, v in assumptions.items() if k != "comparison_months"}
    if doc and doc.get("terms") == terms:
        return doc.get("records")
    return None


async def sync_scenario(scenario: dict) -> dict:
    settings = get_settings()
    if not settings.nessie_api_key:
        raise NessieError("Nessie isn't configured. Add NESSIE_API_KEY to the backend environment, then restart the API.")
    async with _sync_lock:
        cached = await cached_records(scenario["bin"], scenario["assumptions"])
        if cached:
            return cached
        # Fixed allowlisted HTTPS hosts; no redirects with the key in the URL.
        async with httpx.AsyncClient(base_url=settings.nessie_api_url, timeout=12, follow_redirects=False) as http:
            client = NessieClient(http, settings.nessie_api_key)
            ns = namespace()
            profile_key = f"{ns}:profile"
            profile = await store.get_finance_record(profile_key) or {}
            if not profile.get("customer_id"):
                profile["customer_id"] = await client.find_or_create(
                    "/customers",
                    {"first_name": CUSTOMER_NAME[0], "last_name": CUSTOMER_NAME[1],
                     "address": {"street_number": "100", "street_name": "Demo Street", "city": "New York", "state": "NY", "zip": "10001"}},
                    lambda row: (row.get("first_name"), row.get("last_name")) == CUSTOMER_NAME,
                )
                await store.save_finance_record(profile_key, profile)
            if not profile.get("merchant_id"):
                profile["merchant_id"] = await client.find_or_create(
                    "/merchants", {"name": MERCHANT_NAME}, lambda row: row.get("name") == MERCHANT_NAME,
                )
                await store.save_finance_record(profile_key, profile)

            bin_id = scenario["bin"]
            record_key = f"{ns}:building:{bin_id}"
            doc = await store.get_finance_record(record_key) or {}
            # A failed edit must not leave an old scenario marked as synced.
            doc.pop("terms", None)
            doc.pop("records", None)
            await store.save_finance_record(record_key, doc)
            nickname = f"BlindSpot NYC - BIN {bin_id} - DEMO"
            if not doc.get("account_id"):
                doc["account_id"] = await client.find_or_create(
                    f"/customers/{profile['customer_id']}/accounts",
                    {"type": "Checking", "nickname": nickname, "rewards": 0, "balance": 1000000},
                    lambda row: row.get("nickname") == nickname,
                )
                await store.save_finance_record(record_key, doc)
            account = doc["account_id"]
            a = scenario["assumptions"]
            purchase_description = f"BlindSpot NYC - BIN {bin_id} - hypothetical monthly shed rental"
            purchase = {"merchant_id": profile["merchant_id"], "medium": "balance", "purchase_date": date.today().isoformat(),
                        "amount": round(a["monthly_shed_rent"], 2), "status": "pending", "description": purchase_description}
            if not doc.get("purchase_id"):
                doc["purchase_id"] = await client.find_or_create(
                    f"/accounts/{account}/purchases", purchase, lambda row: row.get("description") == purchase_description,
                )
                await store.save_finance_record(record_key, doc)
            # Also update a recovered record to reflect the current assumptions.
            await client.request("PUT", f"/purchases/{doc['purchase_id']}", purchase)
            loan_description = f"BlindSpot NYC - BIN {bin_id} - hypothetical facade repair"
            loan = {"type": "small business", "status": "pending", "credit_score": 700,
                    "monthly_payment": scenario["monthly_loan_payment"], "amount": a["repair_principal"]}
            if not doc.get("loan_id"):
                doc["loan_id"] = await client.find_or_create(
                    f"/accounts/{account}/loans", {**loan, "description": loan_description},
                    lambda row: row.get("description") == loan_description,
                )
                await store.save_finance_record(record_key, doc)
            await client.request("PUT", f"/loans/{doc['loan_id']}", loan)
            # Read back both amounts before calling this a synced Nessie ledger.
            saved_purchase = await client.request("GET", f"/purchases/{doc['purchase_id']}")
            saved_loan = await client.request("GET", f"/loans/{doc['loan_id']}")
            if (not isinstance(saved_purchase, dict) or not isinstance(saved_loan, dict)
                    or saved_purchase.get("amount") != purchase["amount"]
                    or saved_loan.get("amount") != loan["amount"]
                    or saved_loan.get("monthly_payment") != loan["monthly_payment"]):
                raise NessieError("Nessie records could not be verified. The local calculation is still available.")
            records = {**profile, "account_id": account, "purchase_id": doc["purchase_id"], "loan_id": doc["loan_id"],
                       "provider": "nessie", "synced_at": datetime.now(timezone.utc).isoformat(), "initial_mock_balance": 1000000}
            doc["terms"] = {k: v for k, v in a.items() if k != "comparison_months"}
            doc["records"] = records
            await store.save_finance_record(record_key, doc)
            return records
