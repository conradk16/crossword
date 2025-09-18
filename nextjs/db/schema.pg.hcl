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
  column "username" {
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
  // Ensures usernames are unique when set
  index "users_username_key" {
    columns     = [column.username]
    unique = true
  }

  // Case-insensitive prefix search support for usernames
  index "idx_users_lower_username" {
    on {
      expr = "lower(username)"
    }
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

// Stores directed friendship edges for quick lookup of a user's friends.
// For two friends u1 and u2, we store two rows: (u1 -> u2) and (u2 -> u1).
table "friends" {
  schema = schema.public

  column "user_id" {
    type = uuid
    null = false
  }
  column "friend_user_id" {
    type = uuid
    null = false
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }

  // Prevent duplicate edges
  primary_key {
    columns = [column.user_id, column.friend_user_id]
  }

  // Fast lookup of a user's friends
  index "idx_friends_user_id" {
    columns = [column.user_id]
  }

  // Maintain referential integrity to users
  foreign_key "friends_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "friends_friend_user_id_fkey" {
    columns     = [column.friend_user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}

// Tracks friend requests between users and their status.
table "friend_requests" {
  schema = schema.public

  column "id" {
    type = serial
    null = false
  }
  column "requester_user_id" {
    type = uuid
    null = false
  }
  column "recipient_user_id" {
    type = uuid
    null = false
  }
  // One of: 'pending', 'accepted', 'rejected'
  column "status" {
    type    = text
    null    = false
    default = "pending"
  }
  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }
  column "responded_at" {
    type = timestamptz
    null = true
  }

  primary_key {
    columns = [column.id]
  }

  // Prevent multiple rows for the same requester->recipient pair
  index "uq_friend_requests_pair" {
    columns = [column.requester_user_id, column.recipient_user_id]
    unique  = true
  }

  // For quick retrieval of friend requests
  index "idx_friend_requests_recipient_status_created_at" {
    columns = [column.recipient_user_id, column.status, column.created_at]
  }

  // Maintain referential integrity
  foreign_key "friend_requests_requester_fkey" {
    columns     = [column.requester_user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
  foreign_key "friend_requests_recipient_fkey" {
    columns     = [column.recipient_user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}

// Stores one crossword puzzle per Pacific calendar day
table "puzzles" {
  schema = schema.public

  // Date of the puzzle day in America/Los_Angeles time
  column "puzzle_date" {
    type = date
    null = false
  }

  // Puzzle payload (grid + clues) without duplicating the date inside JSON
  column "data" {
    type = jsonb
    null = false
  }

  column "created_at" {
    type    = timestamptz
    null    = false
    default = sql("now()")
  }

  // Enforce exactly one puzzle per date
  primary_key {
    columns = [column.puzzle_date]
  }
}

// Stores users' daily puzzle completion times with Pacific-day uniqueness
table "puzzle_completions" {
  schema = schema.public

  column "id" {
    type = serial
    null = false
  }
  column "user_id" {
    type = uuid
    null = false
  }
  // Date of the puzzle day in America/Los_Angeles time
  column "puzzle_date" {
    type = date
    null = false
  }
  // Completion duration in milliseconds
  column "time_ms" {
    type = integer
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

  // Ensure a single completion per user per Pacific calendar day
  index "uq_puzzle_completions_user_date" {
    columns = [column.user_id, column.puzzle_date]
    unique  = true
  }

  // Helpful lookups
  index "idx_puzzle_completions_user" {
    columns = [column.user_id]
  }
  index "idx_puzzle_completions_date" {
    columns = [column.puzzle_date]
  }

  // Maintain referential integrity to users
  foreign_key "puzzle_completions_user_id_fkey" {
    columns     = [column.user_id]
    ref_columns = [table.users.column.user_id]
    on_update   = NO_ACTION
    on_delete   = CASCADE
  }
}