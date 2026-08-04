CREATE TABLE ledger_accounts (
  account_code    text PRIMARY KEY,
  account_type    text NOT NULL CHECK (account_type IN
                    ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance  text NOT NULL CHECK (normal_balance IN ('debit', 'credit'))
);

CREATE TABLE ledger_transactions (
  ledger_transaction_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id              text        NOT NULL REFERENCES policies (policy_id),
  source_type            text        NOT NULL CHECK (source_type IN ('endorsement', 'payment')),
  source_id              text        NOT NULL,
  description            text        NOT NULL,
  posted_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (source_type, source_id)
);

CREATE TABLE ledger_entries (
  ledger_entry_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_transaction_id  uuid    NOT NULL REFERENCES ledger_transactions (ledger_transaction_id),
  account_code           text    NOT NULL REFERENCES ledger_accounts (account_code),
  amount_cents           bigint  NOT NULL CHECK (amount_cents <> 0),
  currency               char(3) NOT NULL CHECK (currency IN ('USD'))
);

CREATE FUNCTION assert_transaction_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total bigint;
  legs  integer;
BEGIN
  SELECT COALESCE(SUM(amount_cents), 0), COUNT(*)
    INTO total, legs
    FROM ledger_entries
   WHERE ledger_transaction_id = NEW.ledger_transaction_id;

  IF total <> 0 OR legs < 2 THEN
    RAISE EXCEPTION 'unbalanced ledger transaction %: sum=%, legs=%',
      NEW.ledger_transaction_id, total, legs
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_transaction_balanced();

CREATE TRIGGER ledger_transactions_append_only
  BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
