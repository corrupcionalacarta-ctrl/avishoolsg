import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL ?? ''
const key = process.env.SUPABASE_SERVICE_KEY ?? ''

export const supabase = createClient(url, key)

// Kept for backwards compatibility
export function getSupabase() {
  return supabase
}
