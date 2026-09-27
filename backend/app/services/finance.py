"""Hypothetical cash-flow comparison; independent of the building hazard score."""

from decimal import Decimal, ROUND_HALF_UP

from app.models.finance import FinanceAssumptions


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def calculate(building: dict, assumptions: FinanceAssumptions) -> dict:
    principal = Decimal(assumptions.repair_principal)
    rate = Decimal(str(assumptions.annual_interest_pct)) / Decimal(1200)
    term = assumptions.term_months
    payment = principal / term if rate == 0 else principal * rate / (1 - (1 + rate) ** -term)
    total_interest = _money(payment * term - principal)
    # Aggregate the same rounded monthly amounts displayed in the UI.
    payment = Decimal(str(_money(payment)))
    rent = Decimal(str(_money(Decimal(str(assumptions.monthly_shed_rent)))))
    months = min(assumptions.comparison_months, term)
    active = bool(building["shed"].get("active"))
    return {
        "bin": building["bin"],
        "assumptions": assumptions.model_dump(),
        "monthly_loan_payment": _money(payment),
        "monthly_cash_flow_gap": _money(payment - rent),
        "comparison_months": months,
        "shed_rental_total": _money(rent * months),
        "loan_payment_total": _money(payment * months),
        "cumulative_cash_flow_gap": _money((payment - rent) * months),
        "total_loan_interest": total_interest,
        "active_shed": active,
        "shed_age_days": building["shed"].get("age_days") if active else None,
    }
