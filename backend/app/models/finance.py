from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FinanceAssumptions(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    monthly_shed_rent: float = Field(default=1500, ge=0, le=100000, multiple_of=0.01)
    repair_principal: int = Field(default=300000, ge=1000, le=5000000)
    annual_interest_pct: float = Field(default=7, ge=0, le=40)
    term_months: int = Field(default=120, ge=12, le=360)
    comparison_months: int = Field(default=84, ge=1, le=360)


class NessieRecords(BaseModel):
    provider: Literal["nessie"] = "nessie"
    customer_id: str
    merchant_id: str
    account_id: str
    purchase_id: str
    loan_id: str
    synced_at: str
    initial_mock_balance: int = 1000000


class FinanceScenario(BaseModel):
    bin: str
    assumptions: FinanceAssumptions
    monthly_loan_payment: float
    monthly_cash_flow_gap: float
    comparison_months: int
    shed_rental_total: float
    loan_payment_total: float
    cumulative_cash_flow_gap: float
    total_loan_interest: float
    active_shed: bool
    shed_age_days: int | None
    nessie_configured: bool
    records: NessieRecords | None = None
