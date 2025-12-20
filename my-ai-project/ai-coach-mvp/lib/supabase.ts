import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("⚠️ Supabase 설정이 누락되었습니다! .env.local 파일을 확인하세요.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)