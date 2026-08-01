INSERT INTO ledger_accounts (account_code, account_type, normal_balance) VALUES
  ('cash',                'asset',   'debit'),
  ('premium_receivable',  'asset',   'debit'),
  ('written_premium',     'revenue', 'credit');

-- Read-path indexes.
CREATE INDEX ON endorsements          (policy_id);
CREATE INDEX ON payments              (policy_id);
CREATE INDEX ON ledger_transactions   (policy_id);
CREATE INDEX ON ledger_entries        (ledger_transaction_id);
CREATE INDEX ON payment_applications  (billing_document_id);

-- The payment waterfall's ORDER BY, exactly.
CREATE INDEX ON billing_documents (policy_id, due_date, issued_at, billing_document_id);
