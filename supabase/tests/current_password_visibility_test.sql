begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(10);

select extensions.has_column(
  'public',
  'profiles',
  'current_password_plaintext',
  'profiles stores the nullable current-password display copy'
);

select extensions.col_is_null(
  'public',
  'profiles',
  'current_password_plaintext',
  'existing accounts default to no readable password'
);

select extensions.has_column(
  'public',
  'profiles',
  'current_password_auth_version',
  'profiles stores the password version paired with the display copy'
);

select extensions.has_function(
  'public',
  'is_current_auth_session_active',
  array[]::text[],
  'active-session guard exists'
);

select extensions.ok(
  has_function_privilege('authenticated', 'public.is_current_auth_session_active()', 'execute'),
  'authenticated callers can check only their own signed session'
);

select extensions.ok(
  not has_function_privilege('anon', 'public.is_current_auth_session_active()', 'execute'),
  'anonymous callers cannot execute the active-session guard'
);

select extensions.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'current_password_plaintext', 'select'),
  'authenticated callers cannot select the readable password column'
);

select extensions.ok(
  not has_column_privilege('anon', 'public.profiles', 'current_password_plaintext', 'select'),
  'anonymous callers cannot select the readable password column'
);

select extensions.ok(
  not has_column_privilege('authenticated', 'public.profiles', 'current_password_auth_version', 'select'),
  'authenticated callers cannot select the readable password version'
);

select extensions.ok(
  not has_column_privilege('anon', 'public.profiles', 'current_password_auth_version', 'select'),
  'anonymous callers cannot select the readable password version'
);

select * from extensions.finish();
rollback;
