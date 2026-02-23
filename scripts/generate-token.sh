#!/usr/bin/env bash
# Generates a valid kubeadm bootstrap token (format: [a-z0-9]{6}.[a-z0-9]{16})
set -euo pipefail

TOKEN_ID=$(openssl rand -hex 3)
TOKEN_SECRET=$(openssl rand -hex 8)
echo "${TOKEN_ID}.${TOKEN_SECRET}"
