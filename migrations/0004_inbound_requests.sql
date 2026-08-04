CREATE TABLE inbound_requests (
  inbound_request_id  bigserial PRIMARY KEY,
  policy_id           text,
  request_kind        text        NOT NULL CHECK (request_kind IN ('endorsement', 'payment')),
  business_id         text,
  outcome             text        NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  status_code         integer     NOT NULL,
  error_code          text,
  request_body        text        NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now()
);
