import calendar
from typing import List, Dict, Any, Optional
from datetime import datetime
from backend.services.timezone import get_month_bounds, now_tz
from decimal import Decimal, ROUND_HALF_UP

CENT = Decimal("0.01")


def money(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


class PayrollPolicy:
    """Base interface for payroll calculations to allow future policies."""
    def calculate_daily_rate(self, monthly_salary: float, year: int, month: int) -> float:
        raise NotImplementedError

    def calculate_day_earning(self, daily_rate: float, status: Optional[str]) -> float:
        raise NotImplementedError


class CalendarDayPayrollPolicy(PayrollPolicy):
    """
    Standard policy:
    daily_rate = monthly_salary / total_days_in_month
    Present = 1.0 * daily_rate
    Half Day = 0.5 * daily_rate
    Absent / Not Marked = 0.0
    """
    def calculate_daily_rate(self, monthly_salary: float, year: int, month: int) -> float:
        if monthly_salary <= 0:
            return 0.0
        days_in_month = calendar.monthrange(year, month)[1]
        return monthly_salary / days_in_month

    def calculate_day_earning(self, daily_rate: float, status: Optional[str]) -> float:
        if not status:
            return 0.0
        s = status.strip()
        if s == "Present":
            return round(daily_rate, 2)
        elif s == "Half Day":
            return round(daily_rate * 0.5, 2)
        return 0.0


# Default active payroll policy
default_policy = CalendarDayPayrollPolicy()


class PayrollService:
    @staticmethod
    def calculate_worker_month_summary(
        worker: Dict[str, Any],
        attendance_list: List[Dict[str, Any]],
        payments_list: List[Dict[str, Any]],
        extra_work_list: List[Dict[str, Any]],
        date_str: Optional[str] = None,
        policy: PayrollPolicy = default_policy,
    ) -> Dict[str, Any]:
        """
        Authoritatively calculates salary earned, payments, advances, and remaining balance.
        """
        m_start, m_end, year, month = get_month_bounds(date_str)
        days_in_month = calendar.monthrange(year, month)[1]
        monthly_salary_decimal = Decimal(str(worker.get("salary", 0) or 0))
        monthly_salary = money(monthly_salary_decimal)
        daily_rate = monthly_salary_decimal / Decimal(days_in_month) if monthly_salary_decimal > 0 else Decimal("0")

        # Filter active month records
        month_att = [a for a in attendance_list if m_start <= a.get("date", "") < m_end]
        
        # Only count payments that are not soft-deleted
        active_payments = [p for p in payments_list if not p.get("deleted_at")]
        month_payments = [p for p in active_payments if m_start <= p.get("date", "") < m_end]
        
        # Extra work
        active_extra = [e for e in extra_work_list if not e.get("deleted_at")]
        month_extra = [e for e in active_extra if m_start <= e.get("date", "") < m_end]

        # Attendance breakdown & earnings
        present_count = 0
        half_day_count = 0
        absent_count = 0
        earned_salary = Decimal("0")

        for a in month_att:
            st = a.get("status")
            if st == "Present":
                present_count += 1
                earned_salary += daily_rate
            elif st == "Half Day":
                half_day_count += 1
                earned_salary += daily_rate * Decimal("0.5")
            elif st == "Absent":
                absent_count += 1

        earned_salary = money(earned_salary)

        # Payment categories in this month
        salary_paid_month = sum((
            Decimal(str(p.get("amount", 0))) for p in month_payments
            if p.get("type", "SALARY_PAYMENT") == "SALARY_PAYMENT"
        ), Decimal("0"))
        advances_month = sum((
            Decimal(str(p.get("amount", 0))) for p in month_payments
            if p.get("type") == "ADVANCE"
        ), Decimal("0"))
        extra_work_paid_month = sum((
            Decimal(str(p.get("amount", 0))) for p in month_payments
            if p.get("type") == "EXTRA_WORK_PAYMENT"
        ), Decimal("0"))
        adjustments_month = sum((
            Decimal(str(p.get("amount", 0))) for p in month_payments
            if p.get("type") == "ADJUSTMENT"
        ), Decimal("0"))

        total_paid_month = salary_paid_month + advances_month + extra_work_paid_month + adjustments_month

        # Extra work earned this month
        extra_work_earned_month = money(sum((Decimal(str(e.get("amount", 0))) for e in month_extra), Decimal("0")))

        # Gross earned this month = earned attendance salary + extra work earned
        gross_earned_month = money(earned_salary + extra_work_earned_month)

        # Remaining payable for this month
        remaining_payable_month = money(gross_earned_month - total_paid_month)

        # All-time metrics
        paid_all_time = money(sum((Decimal(str(p.get("amount", 0))) for p in active_payments), Decimal("0")))
        extra_total_all_time = money(sum((Decimal(str(e.get("amount", 0))) for e in active_extra), Decimal("0")))

        return {
            "monthly_salary": float(monthly_salary),
            "daily_rate": float(money(daily_rate)),
            "days_in_month": days_in_month,
            "present_days": present_count,
            "half_days": half_day_count,
            "absent_days": absent_count,
            "earned_salary": float(earned_salary),
            "extra_work_earned": float(extra_work_earned_month),
            "gross_earned": float(gross_earned_month),
            "paid_this_month": float(money(salary_paid_month)),
            "advance_taken": float(money(advances_month)),
            "extra_work_paid": float(money(extra_work_paid_month)),
            "total_paid_month": float(money(total_paid_month)),
            "remaining_payable": float(remaining_payable_month),
            "remaining_this_month": float(max(Decimal("0"), remaining_payable_month)),
            "total_paid": float(paid_all_time),
            "extra_total": float(extra_total_all_time),
            "total_earnings": float(money(paid_all_time + extra_total_all_time)),
        }
