CREATE TABLE endorsements (
  endorsement_id                 text PRIMARY KEY
                                   CHECK (endorsement_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  policy_id                      text     NOT NULL REFERENCES policies (policy_id),
  effective_date                 date     NOT NULL,
  previous_annual_premium_cents  bigint   NOT NULL CHECK (previous_annual_premium_cents >= 0),
  new_annual_premium_cents       bigint   NOT NULL CHECK (new_annual_premium_cents >= 0),
  delta_cents                    bigint   NOT NULL,
  reason                         text,
  request_fingerprint            char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  policy_seq                     integer  NOT NULL,
  applied_at                     timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (policy_id, policy_seq) REFERENCES policy_events (policy_id, seq)
);

CREATE SEQUENCE billing_document_number_seq START WITH 3001;

CREATE TABLE billing_documents (
  billing_document_id  text PRIMARY KEY
                         DEFAULT ('BILL-' || nextval('billing_document_number_seq')),
  policy_id            text        NOT NULL REFERENCES policies (policy_id),
  endorsement_id       text        NOT NULL UNIQUE REFERENCES endorsements (endorsement_id),
  document_type        text        NOT NULL CHECK (document_type IN
                                     ('endorsement_adjustment', 'premium_credit')),
  amount_cents         bigint      NOT NULL CHECK (amount_cents > 0),
  currency             char(3)     NOT NULL CHECK (currency IN ('USD')),
  due_date             date        NOT NULL,
  issued_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  payment_id           text PRIMARY KEY CHECK (payment_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  policy_id            text     NOT NULL REFERENCES policies (policy_id),
  external_payment_id  text     NOT NULL UNIQUE,
  amount_cents         bigint   NOT NULL CHECK (amount_cents > 0),
  currency             char(3)  NOT NULL CHECK (currency IN ('USD')),
  received_at          text     NOT NULL CHECK (received_at ~
                                  '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'),
  request_fingerprint  char(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  policy_seq           integer  NOT NULL,
  recorded_at          timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (policy_id, policy_seq) REFERENCES policy_events (policy_id, seq)
);

CREATE TABLE payment_applications (
  payment_application_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id              text        NOT NULL REFERENCES payments (payment_id),
  billing_document_id     text        NOT NULL REFERENCES billing_documents (billing_document_id),
  amount_cents            bigint      NOT NULL CHECK (amount_cents > 0),
  applied_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (payment_id, billing_document_id)
);

CREATE TRIGGER payment_applications_append_only
  BEFORE UPDATE OR DELETE ON payment_applications
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
