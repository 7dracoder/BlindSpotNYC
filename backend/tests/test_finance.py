import asyncio
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from pydantic import ValidationError

from app.main import app
from app.models.finance import FinanceAssumptions
from app.services import finance, nessie_client, store

BUILDING = {"bin": "2000001", "shed": {"active": True, "age_days": 2600}}


class FinanceMathTests(unittest.TestCase):
    def test_standard_example_and_displayed_totals(self):
        result = finance.calculate(BUILDING, FinanceAssumptions())
        self.assertEqual(result["monthly_loan_payment"], 3483.25)
        self.assertEqual(result["monthly_cash_flow_gap"], 1983.25)
        self.assertEqual(result["cumulative_cash_flow_gap"], 166593)
        self.assertEqual(result["shed_rental_total"], 126000)
        self.assertEqual(result["loan_payment_total"], 292593)
        self.assertEqual(BUILDING, {"bin": "2000001", "shed": {"active": True, "age_days": 2600}})

    def test_zero_interest_negative_gap_and_horizon_cap(self):
        result = finance.calculate({"bin": "1000001", "shed": {"active": False}}, FinanceAssumptions(
            repair_principal=12000, annual_interest_pct=0, term_months=12, monthly_shed_rent=1500, comparison_months=84,
        ))
        self.assertEqual(result["monthly_loan_payment"], 1000)
        self.assertEqual(result["monthly_cash_flow_gap"], -500)
        self.assertEqual(result["cumulative_cash_flow_gap"], -6000)
        self.assertEqual(result["comparison_months"], 12)
        self.assertEqual(result["total_loan_interest"], 0)
        self.assertIsNone(result["shed_age_days"])

    def test_validation_rejects_invalid_and_nonfinite_values(self):
        for kwargs in [{"annual_interest_pct": float("nan")}, {"monthly_shed_rent": float("inf")},
                       {"repair_principal": -1}, {"term_months": 0}, {"comparison_months": 0},
                       {"monthly_shed_rent": 1.005}, {"unrecognized": 5}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                FinanceAssumptions(**kwargs)


class MockNessie:
    def __init__(self):
        self.rows = {"customers": {}, "merchants": {}, "accounts": {}, "purchases": {}, "loans": {}}
        self.calls = []
        self.timeout_after_purchase = False
        self.fail_loan_update = False

    def handle(self, request):
        self.calls.append((request.method, request.url.path))
        assert request.url.params["key"] == "test-secret"
        bits = request.url.path.strip("/").split("/")
        collection = bits[-1] if len(bits) in (1, 3) else bits[0]
        rows = self.rows[collection]
        if request.method == "GET":
            if len(bits) == 2:
                return httpx.Response(200, json=rows[bits[1]])
            if len(bits) == 3:
                return httpx.Response(200, json=[r for r in rows.values() if r["parent"] == bits[1]])
            return httpx.Response(200, json=list(rows.values()))
        body = json.loads(request.content)
        if request.method == "POST":
            record_id = f"{collection}-{len(rows) + 1}"
            row = {**body, "_id": record_id}
            if len(bits) == 3:
                row["parent"] = bits[1]
            rows[record_id] = row
            if collection == "purchases" and self.timeout_after_purchase:
                self.timeout_after_purchase = False
                raise httpx.ReadTimeout("Response lost after create", request=request)
            return httpx.Response(201, json={"code": 201, "objectCreated": row})
        if self.fail_loan_update and collection == "loans":
            return httpx.Response(503, json={"message": "failed"})
        rows[bits[1]].update(body)
        return httpx.Response(202, json={"code": 202})


class NessieTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock = MockNessie()
        self.client_class = httpx.AsyncClient
        self.handler = self.mock.handle
        self.patches = [
            patch("app.services.nessie_client.get_settings", return_value=SimpleNamespace(nessie_api_key="test-secret", nessie_api_url="https://prod-api.nessieisreal.com")),
            patch("app.services.nessie_client.httpx.AsyncClient", side_effect=lambda **kw: self.client_class(base_url=kw["base_url"], transport=httpx.MockTransport(self.handler))),
            patch("app.services.store.get_db", return_value=None),
        ]
        for p in self.patches:
            p.start()
        store._finance.clear()
        nessie_client._sync_lock = asyncio.Lock()

    async def asyncTearDown(self):
        for p in reversed(self.patches):
            p.stop()
        store._finance.clear()

    async def test_remote_records_readback_and_repeated_requests_reuse_ids(self):
        scenario = finance.calculate(BUILDING, FinanceAssumptions())
        first, second = await asyncio.gather(nessie_client.sync_scenario(scenario), nessie_client.sync_scenario(scenario))
        self.assertEqual(first, second)
        self.assertEqual(len(self.mock.rows["accounts"]), 1)
        self.assertEqual(len(self.mock.rows["purchases"]), 1)
        self.assertEqual(len(self.mock.rows["loans"]), 1)
        self.assertEqual(self.mock.rows["loans"][first["loan_id"]]["monthly_payment"], 3483.25)
        self.assertEqual(first["initial_mock_balance"], 1000000)
        # Changing the horizon does not create new banking records.
        different_horizon = finance.calculate(BUILDING, FinanceAssumptions(comparison_months=12))
        self.assertEqual(await nessie_client.sync_scenario(different_horizon), first)
        self.assertNotIn("test-secret", json.dumps(first))

    async def test_edits_update_existing_records_and_partial_failure_invalidates_cache(self):
        original = finance.calculate(BUILDING, FinanceAssumptions())
        first = await nessie_client.sync_scenario(original)
        self.mock.fail_loan_update = True
        changed = finance.calculate(BUILDING, FinanceAssumptions(monthly_shed_rent=2000))
        with self.assertRaises(nessie_client.NessieError):
            await nessie_client.sync_scenario(changed)
        self.assertIsNone(await nessie_client.cached_records(BUILDING["bin"], original["assumptions"]))
        self.mock.fail_loan_update = False
        updated = await nessie_client.sync_scenario(changed)
        self.assertEqual(first["account_id"], updated["account_id"])
        self.assertEqual(first["purchase_id"], updated["purchase_id"])
        self.assertEqual(first["loan_id"], updated["loan_id"])
        self.assertEqual(self.mock.rows["purchases"][first["purchase_id"]]["amount"], 2000)
        self.assertEqual(len(self.mock.rows["purchases"]), 1)

    async def test_interrupted_post_is_recovered_without_duplicate_purchase(self):
        self.mock.timeout_after_purchase = True
        scenario = finance.calculate(BUILDING, FinanceAssumptions())
        with self.assertRaises(nessie_client.NessieError) as error:
            await nessie_client.sync_scenario(scenario)
        self.assertNotIn("test-secret", str(error.exception))
        records = await nessie_client.sync_scenario(scenario)
        self.assertEqual(records["purchase_id"], "purchases-1")
        self.assertEqual(len(self.mock.rows["purchases"]), 1)

    async def test_verification_mismatch_never_marks_ledger_synced(self):
        original = self.mock.handle
        def wrong_amount(request):
            response = original(request)
            if request.method == "GET" and request.url.path.startswith("/loans/"):
                return httpx.Response(200, json={**response.json(), "monthly_payment": 999})
            return response
        self.handler = wrong_amount
        scenario = finance.calculate(BUILDING, FinanceAssumptions())
        with self.assertRaises(nessie_client.NessieError):
            await nessie_client.sync_scenario(scenario)
        self.assertIsNone(await nessie_client.cached_records(BUILDING["bin"], scenario["assumptions"]))


class FinanceRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_local_mode_validation_and_missing_building(self):
        with patch("app.routers.api.store.get_building", AsyncMock(return_value=copy.deepcopy(BUILDING))), patch(
            "app.routers.api.get_settings", return_value=SimpleNamespace(nessie_api_key="")
        ), patch("app.services.nessie_client.get_settings", return_value=SimpleNamespace(nessie_api_key="")):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/api/finance/2000001")
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["nessie_configured"])
                self.assertIsNone(response.json()["records"])
                self.assertEqual(response.json()["monthly_loan_payment"], 3483.25)
                response = await client.post("/api/finance/2000001/nessie", json={})
                self.assertEqual(response.status_code, 503)
                response = await client.post("/api/finance/2000001", json={"annual_interest_pct": -2})
                self.assertEqual(response.status_code, 422)
                with patch("app.routers.api.store.get_building", AsyncMock(return_value=None)):
                    self.assertEqual((await client.get("/api/finance/9999999")).status_code, 404)
