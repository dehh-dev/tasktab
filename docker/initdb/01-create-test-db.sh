#!/bin/sh
# Cria o banco usado pelos testes automatizados ao lado do banco de desenvolvimento.
# Executado apenas na primeira inicializacao do volume do Postgres.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE tasktab_test;
EOSQL
