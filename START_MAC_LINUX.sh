#!/bin/bash
command -v node &>/dev/null||{echo "Install Node.js from nodejs.org";exit 1;}
[ ! -d "node_modules" ] && npm install
mkdir -p data public/pdfs public/logo
echo "DISPLAY: http://localhost:3000/display  (pw: display123)"
echo "ADMIN:   http://localhost:3000/admin    (pw: admin123)"
node server.js
