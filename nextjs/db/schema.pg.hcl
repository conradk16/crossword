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
    columns     = [column.email]
    unique = true
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