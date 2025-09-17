schema "public" {
  comment = "The default public schema"
}

// Defines the table for storing one-time password codes.
table "otp_codes" {
  schema = schema.public

  column "id" {
    type = serial
    null = false
  }
  column "email" {
    type = text
    null = false
  }
  column "code" {
    type = text
    null = false
    comment = "This will store the HASHED OTP"
  }
  column "expires_at" {
    type = timestamptz
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }

  primary_key {
    columns = [column.id]
  }

  index "idx_otp_codes_email" {
    columns = [column.email]
  }
  // Composite index to efficiently fetch recent codes for an email.
  index "idx_otp_codes_email_created_at" {
    columns = [column.email, column.created_at]
  }
}

// Tracks failed OTP login attempts per email per day.
table "otp_failed_attempts" {
  schema = schema.public

  column "id" {
    type = serial
    null = false
  }
  column "email" {
    type = text
    null = false
  }
  column "attempted_at" {
    type = timestamptz
    null = false
    default = sql("now()")
  }

  primary_key {
    columns = [column.id]
  }

  index "idx_failed_attempts_email_attempted_at" {
    columns = [column.email, column.attempted_at]
  }
}

// Defines the permanent table for all registered users.
table "users" {
  schema = schema.public

  column "user_id" {
    type = uuid
    null = false
    // Uses the extension to generate a v4 UUID by default
    default = sql("gen_random_uuid()") 
  }
  column "email" {
    type = text
    null = false
  }
  column "name" {
    type    = text
    null    = true
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "updated_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }

  primary_key {
    columns = [column.user_id]
  }

  // Ensures no two users can have the same email address.
  index "users_email_key" {
    columns     = [column.email]
    unique = true
  }
}

// Stores the current session token (hashed) per user. One active token per user.
table "user_sessions" {
  schema = schema.public

  column "user_id" {
    type = uuid
    null = false
  }
  column "token_hash" {
    type = text
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }

  // Ensure a single session per user (overwrites will replace this row)
  primary_key {
    columns = [column.user_id]
  }

  // Fast lookup by token hash for authenticated requests
  index "user_sessions_token_hash_key" {
    columns = [column.token_hash]
    unique = true
  }

  // Maintain referential integrity to users
  foreign_key "user_sessions_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}