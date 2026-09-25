#!/usr/bin/env bash
# Instalação do SrRobs Free Games num VPS Linux (Ubuntu/Debian).
# Uso:  bash deploy/install.sh
# Requisito: estar na pasta do projeto (git clone ou upload).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "═══ SrRobs Free Games — instalação em ${PROJECT_DIR} ═══"

# 1. Node 20 se não existir
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'parseInt(process.versions.node)')" -lt 20 ]; then
  echo "→ A instalar Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "→ Node $(node --version)"

# 2. Dependências do projeto
cd "$PROJECT_DIR"
echo "→ npm install..."
npm install --omit=dev --no-audit --no-fund

# 3. Configuração interativa (não sobrescreve .env existente)
if [ ! -f .env ]; then
  echo "→ Configuração inicial (wizard)..."
  node scripts/setup.js || echo "⚠️ Wizard falhou/foi interrompido — cria o .env à mão depois."
else
  echo "→ .env já existe — a manter."
fi

# 4. Utilizador de serviço (usa o atual por omissão)
SERVICE_USER="${SUDO_USER:-$USER}"

# 5. Unidade systemd
echo "→ A instalar serviço systemd (utilizador: ${SERVICE_USER})..."
sudo tee /etc/systemd/system/srrobs.service >/dev/null <<EOF
$(sed "s|^User=.*|User=${SERVICE_USER}|; s|^WorkingDirectory=.*|WorkingDirectory=${PROJECT_DIR}|" deploy/srrobs.service)
EOF
sudo systemctl daemon-reload
sudo systemctl enable srrobs

echo ""
echo "═══ Instalação concluída ═══"
echo "Próximos passos:"
echo " 1. Regista os comandos do Discord: npm run deploy-commands"
echo " 2. Arranca e fica ativo ao reiniciar o servidor:"
echo "    sudo systemctl start srrobs"
echo " 3. Ver logs:  journalctl -u srrobs -f"
