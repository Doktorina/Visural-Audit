#!/bin/bash
curl -s -X POST http://127.0.0.1:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"regtest'"$(date +%s)"'@gmail.com","name":"Test User","company":"OOO","phone":"+79001112233"}'
echo
