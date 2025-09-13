# Define the schema first, so it can be referenced later.
schema "public" {
  comment = "The default public schema"
}

# A table to store test data.
table "test" {
  # Reference the schema object defined above.
  schema = schema.public

  column "id" {
    # Use the sql() function to specify raw SQL types.
    type = sql("bigint")
    null = false
    identity {
      generated = BY_DEFAULT
    }
  }
  column "name" {
    type = sql("text")
    null = true
  }
  column "created_at" {
    type    = sql("timestamptz")
    null    = false
    default = sql("now()")
  }
  primary_key {
    columns = [column.id]
  }
}