#!/usr/bin/env bash
# Runs every tests/*.test.js and prints a summary. Exits non-zero if any fail.
cd "$(dirname "$0")"
pass=0; fail=0; failed=()
for f in ${@:-*.test.js}; do
  [ -e "$f" ] || continue
  out=$(node "$f" 2>&1); code=$?
  line=$(printf '%s\n' "$out" | grep -iE "passed|PASSED" | tail -1)
  printf '%-26s %s\n' "$(basename "$f" .test.js)" "${line:-$(printf '%s' "$out" | tail -1)}"
  if [ $code -eq 0 ]; then pass=$((pass+1)); else fail=$((fail+1)); failed+=("$f"); printf '%s\n' "$out" | grep -E "✗|FAIL|Error" | head -5; fi
done
echo "---"; echo "suites: $pass passed, $fail failed"
[ $fail -eq 0 ] || { printf 'failed: %s\n' "${failed[*]}"; exit 1; }
