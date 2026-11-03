#!/bin/bash
set -e
URL='postgresql://victory:victory_check_2026@127.0.0.1:5432/victory_check'
echo '=== PostgreSQL counts ==='
psql "$URL" -t -A -c "SELECT 'objects', count(*) FROM objects UNION ALL SELECT 'violations', count(*) FROM violations UNION ALL SELECT 'contractors', count(*) FROM contractors UNION ALL SELECT 'users', count(*) FROM users;"
echo '=== objects ==='
psql "$URL" -c "SELECT id, code, name FROM objects ORDER BY id;"
echo '=== contractors ==='
psql "$URL" -c "SELECT id, name, email FROM contractors ORDER BY id LIMIT 20;"
