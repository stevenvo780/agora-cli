# `agora` — CLI para workspaces de Agora

Trabaja tus workspaces de Agora desde **cualquier Linux/Mac/Windows con Node 18+**, usando tu IDE
preferido (VS Code, vim, JetBrains, etc.). Todo cambio que hagas localmente se sincroniza con el
NAS via Git interno (Forgejo); el editor web de Agora ve esos cambios al próximo refresh.

## Instalación

### Fedora / RHEL / CentOS / Rocky / Alma
```bash
# Node LTS desde NodeSource (Fedora 38+):
sudo dnf install -y https://rpm.nodesource.com/pub_lts.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm
sudo dnf install -y nodejs git

# Configurar npm para instalar sin sudo:
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc && source ~/.bashrc

# Instalar Agora CLI:
npm install -g @stevenvo780/agora-cli
```

### Ubuntu / Debian / Pop / Mint
```bash
sudo apt update && sudo apt install -y nodejs npm git
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc && source ~/.bashrc
npm install -g @stevenvo780/agora-cli
```

### Arch / Manjaro
```bash
sudo pacman -S --needed nodejs npm git
npm install -g @stevenvo780/agora-cli  # usa /usr/lib/node_modules
```

### macOS
```bash
brew install node git
npm install -g @stevenvo780/agora-cli
```

### Windows
```powershell
winget install OpenJS.NodeJS Git.Git
npm install -g @stevenvo780/agora-cli
```

### Desde el repo (desarrollo)
```bash
cd AgoraCli
npm link
```

## Uso básico
```bash
agora --help
agora login                       # configura URL del API + ID token Firebase
agora workspaces                  # lista tus workspaces (alias: agora ls)
agora clone <wsId> [dir]          # clona el repo del workspace en `dir`
agora pull [dir]                  # actualiza desde el NAS
agora push [dir] -m "mensaje"     # sube cambios al NAS
agora watch [dir]                 # sync automático cada 30s
agora status [dir]                # estado local: login, workspace id, git
agora init <dir>                  # apunta un dir existente a un workspace
agora logout                      # borra credenciales locales
```

## Alcance mínimo estable

- `auth`: `login`, `logout`, lectura segura de `~/.agora/config.json`.
- `status`: inspección local sin imprimir tokens.
- `clone`: provisiona/lee repo Forgejo y configura `git config agora.workspaceId`.
- `sync`: `pull`, `push`, `watch` sobre Git.
- `open editor`: no abre un editor específico todavía; el flujo soportado es clonar/init y abrir el directorio con tu IDE preferido.

## Cómo funciona

- Cada workspace de Agora tiene su propio repositorio Git en Forgejo (`agora/<workspaceId>` para
  shared, `agora/personal-<uid>` para personal).
- `agora clone` hace `git clone` con tu token personal de Forgejo (provisionado al primer uso).
- `agora push` agrega + commitea + push.
- `agora watch` corre `git pull --rebase` + autocommit + push periódicamente.
- El editor web de Agora también empuja cambios al mismo repo cuando guardas en él.
- El servidor de workers (terminales en la nube) hace `git pull --rebase` cada 60s.

Resultado: editas en VS Code → push → editor web ve el cambio.
Editas en el editor web → autocommit → tu local hace pull → IDE refleja el cambio.

## Sin perder nada

Si ya tienes una carpeta con archivos antes de `clone`, usa `agora init <dir>` y haz un `agora pull`
después; git resolverá merges y, en conflicto, los archivos quedarán marcados para que decidas.

## Config

- `~/.agora/config.json` (chmod 600): apiUrl, token, uid, email.
- `git config agora.workspaceId` por repo: el id del workspace al que apunta.
