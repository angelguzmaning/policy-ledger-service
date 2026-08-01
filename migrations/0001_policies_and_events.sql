CREATE TABLE policies (
  policy_id             text PRIMARY KEY CHECK (policy_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  homeowner_id          text        NOT NULL,
  status                text        NOT NULL CHECK (status IN ('active', 'cancelled', 'expired')),
  term_start            date        NOT NULL,
  term_end              date        NOT NULL,
  annual_premium_cents  bigint      NOT NULL CHECK (annual_premium_cents >= 0),
  currency              char(3)     NOT NULL CHECK (currency IN ('USD')),
  CHECK (term_end > term_start)
);

CREATE TABLE policy_events (
  policy_id      text     NOT NULL REFERENCES policies (policy_id),
  seq            integer  NOT NULL CHECK (seq >= 1),
  hash_version   integer  NOT NULL DEFAULT 1,
  event_type     text     NOT NULL CHECK (event_type IN
                            ('policy_created', 'endorsement_applied', 'payment_recorded')),
  recorded_at    text     NOT NULL CHECK (recorded_at ~
                            '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'),
  payload        text     NOT NULL,
  previous_hash  char(64) CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  event_hash     char(64) NOT NULL CHECK (event_hash ~ '^[0-9a-f]{64}$'),

  PRIMARY KEY (policy_id, seq),
  UNIQUE (policy_id, previous_hash),
  CHECK ((seq = 1) = (previous_hash IS NULL)),
  CHECK ((seq = 1) = (event_type = 'policy_created'))
);

CREATE FUNCTION refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER policy_events_append_only
  BEFORE UPDATE OR DELETE ON policy_events
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
