# =============================================================================
# Template for secret values. Copy to <env>.secrets.tfvars, e.g.:
#     copy infra\environments\example.secrets.tfvars infra\environments\prod.secrets.tfvars
# <env>.secrets.tfvars files are git-ignored; scripts/deploy.mjs loads them automatically.
# Values are stored as encrypted SecureString parameters in SSM Parameter Store.
# =============================================================================

# Secret environment variables for your backend (JWT keys, API tokens, SMTP passwords...)
app_secrets = {
  # JWT_SECRET        = "replace-with-a-long-random-string"
  # RAZORPAY_KEY_ID   = "your-key-id"
  # RAZORPAY_KEY_SECRET = "your-key-secret"
  # SMTP_HOST         = "smtp.example.com"
  # SMTP_USER         = "your-email@example.com"
  # SMTP_PASS         = "your-email-password"
}

# Only when database_mode = "external" (MongoDB Atlas, Amazon DocumentDB...)
# mongodb_uri = "mongodb+srv://user:password@cluster0.xxxxx.mongodb.net/app?retryWrites=true&w=majority"
