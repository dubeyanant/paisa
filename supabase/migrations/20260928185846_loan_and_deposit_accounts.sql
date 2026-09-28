-- Two more account types (TD-13):
--   loan:    money owed, like an education or personal loan. The balance is
--            negative while money is owed; repayments are transfers into it.
--   deposit: money held elsewhere that comes back, like a rent deposit. Moving
--            money into it is neither spending nor saving.
-- Only widens the allowed values, so the deployed app keeps working (TD-3).

alter table public.accounts
  drop constraint accounts_type_check,
  add constraint accounts_type_check
    check (type in ('bank', 'credit_card', 'wallet', 'savings', 'loan', 'deposit'));
