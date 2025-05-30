@echo off
echo Stopping PostgreSQL...
net stop postgresql-x64-17

echo Starting PostgreSQL in single-user mode...
"C:\Program Files\PostgreSQL\17\bin\postgres.exe" --single -D "C:\Program Files\PostgreSQL\17\data" postgres <<EOF
CREATE USER temp_admin WITH SUPERUSER PASSWORD 'temp123';
EOF

echo Starting PostgreSQL service...
net start postgresql-x64-17

echo You can now connect with: psql -U temp_admin -p 5433
