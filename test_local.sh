#!/bin/bash
set -e

# desactivar expansión de historial para el bang (!)
set +H

BASE="http://localhost:3000"

SECRET="MiSecretFuert3_!2025"
STORE_ID="test_store_$(date +%s)"
ACCESS_TOKEN="tokentest"
ORDER_ID="checkout_$(date +%s)"
CART_URL="https://example.com/checkout/${ORDER_ID}"

echo "1. Registrar tienda"
curl -s -X POST "$BASE/api/register_store" \
  -H "Content-Type: application/json" \
  -d "{\"store_id\":\"$STORE_ID\",\"access_token\":\"$ACCESS_TOKEN\"}" | jq

echo
echo "2. Ver stores (debug)"
curl -s "$BASE/api/debug_stores?secret=$SECRET" | jq

echo
echo "3. Enviar checkout"
curl -s -X POST "$BASE/api/checkout" \
  -H "Content-Type: application/json" \
  -d "{\"store_id\":\"$STORE_ID\",\"order_id\":\"$ORDER_ID\",\"cart_url\":\"$CART_URL\"}" | jq

echo
echo "4. Ver checkouts (antes de procesar)"
curl -s "$BASE/api/debug_checkouts?secret=$SECRET&store_id=$STORE_ID" | jq

echo
echo "5. Forzar processing pending"
curl -s -X POST "$BASE/api/run-pending?secret=$SECRET" | jq

echo
echo "6. Ver checkouts (después)"
curl -s "$BASE/api/debug_checkouts?secret=$SECRET&store_id=$STORE_ID" | jq