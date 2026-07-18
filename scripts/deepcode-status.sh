#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════╗
# ║  Deep Code Status — Terminal Status Bar Script              ║
# ║  Shows DeepSeek API balance, model, and session info.       ║
# ║                                                              ║
# ║  Usage:                                                      ║
# ║    bash scripts/deepcode-status.sh                           ║
# ║    bash scripts/deepcode-status.sh --tmux   (for tmux bar)  ║
# ║    bash scripts/deepcode-status.sh --watch 5                ║
# ║    bash scripts/deepcode-status.sh --balance                ║
# ╚══════════════════════════════════════════════════════════════╝

set -euo pipefail

BALANCE_CACHE="${TMPDIR:-/tmp}/deepcode-balance.cache"
CACHE_TTL=30

# ---- Resolve API key via a single node call (avoids bash↔node path issues) ----

API_KEY=$(node -e "
  var fs=require('fs'), path=require('path'), os=require('os');
  var key = process.env.DEEPSEEK_API_KEY || '';

  function readKey(filePath) {
    try {
      var d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return d.env.API_KEY || '';
    } catch(e) { return ''; }
  }

  // Walk up from cwd
  if (!key) {
    var dir = process.cwd();
    while (dir !== path.parse(dir).root) {
      var f = path.join(dir, '.deepcode', 'settings.json');
      if (fs.existsSync(f)) { key = readKey(f); if (key) break; }
      var parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Fallback: homedir
  if (!key) {
    var home = path.join(os.homedir(), '.deepcode', 'settings.json');
    if (fs.existsSync(home)) key = readKey(home);
  }

  process.stdout.write(key);
" 2>/dev/null)

# ---- Fetch balance ----------------------------------------------------
fetch_balance() {
  if [[ -z "$API_KEY" ]]; then
    echo '{"error":"no_key"}'
    return
  fi

  # Cache check
  if [[ -f "$BALANCE_CACHE" ]]; then
    local age=0 now
    now=$(date +%s)
    if [[ "$(uname -s)" == "Darwin" ]]; then
      age=$((now - $(stat -f %m "$BALANCE_CACHE" 2>/dev/null || echo 0)))
    else
      age=$((now - $(stat -c %Y "$BALANCE_CACHE" 2>/dev/null || echo 0)))
    fi
    if [[ $age -lt $CACHE_TTL ]]; then
      cat "$BALANCE_CACHE"
      return
    fi
  fi

  local resp
  resp=$(curl -s --max-time 5 \
    -H "Authorization: Bearer $API_KEY" \
    https://api.deepseek.com/user/balance 2>/dev/null) || true

  if [[ -n "$resp" ]] && echo "$resp" | grep -q '"is_available":true' 2>/dev/null; then
    echo "$resp" > "$BALANCE_CACHE"
  fi
  echo "${resp:-{\"error\":\"unreachable\"}}"
}

# ---- JSON value extractor (node stdin) --------------------------------
json_val() {
  node -e "
    var d='';
    process.stdin.on('data',function(c){d+=c});
    process.stdin.on('end',function(){
      try{
        var o=JSON.parse(d);
        var path='$1'.split('.');
        var v=o;
        for(var i=0;i<path.length;i++){if(v==null)break;v=v[path[i]]}
        process.stdout.write(v!=null?String(v):'');
      }catch(e){}
    })
  " 2>/dev/null
}

# ---- Formatting ------------------------------------------------------
BOLD='\033[1m'; CYAN='\033[0;36m'; DIM='\033[2m'; NC='\033[0m'
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'

output_default() {
  local json total granted topped has_err
  json=$(fetch_balance)
  total=$(echo "$json" | json_val "balance_infos.0.total_balance")
  granted=$(echo "$json" | json_val "balance_infos.0.granted_balance")
  topped=$(echo "$json" | json_val "balance_infos.0.topped_up_balance")
  has_err=$(echo "$json" | json_val "error")

  echo ""
  echo -e "  ${BOLD}Deep Code Status${NC}"
  echo -e "  ${DIM}─────────────────────────────────${NC}"
  echo ""

  if [[ -n "$has_err" ]]; then
    echo -e "  ${CYAN}Balance:${NC}  🔌 offline (${has_err})"
  elif [[ -n "$total" && "$total" != "0" ]]; then
    local color="$GREEN"
    if node -e "process.exit(parseFloat('$total')>=5?0:1)" 2>/dev/null; then color="$GREEN"
    elif node -e "process.exit(parseFloat('$total')>=1?0:1)" 2>/dev/null; then color="$YELLOW"
    else color="$RED"; fi
    echo -e "  ${CYAN}Balance:${NC}  ${color}\$${total} USD${NC}"
    if [[ "$topped" != "0.00" || "$granted" != "0.00" ]]; then
      echo -e "  ${DIM}         topped-up \$${topped}  |  granted \$${granted}${NC}"
    fi
  else
    echo -e "  ${CYAN}Balance:${NC}  🔌 offline"
  fi

  echo -e "  ${CYAN}Model:${NC}    ${BOLD}deepseek-v4-pro${NC}"

  # Session uptime
  local pidfile="${TMPDIR:-/tmp}/deepcode-session.pid"
  if [[ -f "$pidfile" ]]; then
    local pid start=0 now elapsed
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      if [[ -d "/proc/$pid" ]]; then
        start=$(stat -c %Y "/proc/$pid" 2>/dev/null || echo 0)
      elif [[ "$(uname -s)" == "Darwin" ]]; then
        start=$(ps -o lstart= -p "$pid" 2>/dev/null | xargs)
        [[ -n "$start" ]] && start=$(date -j -f "%a %b %d %T %Y" "$start" +%s 2>/dev/null) || start=0
      fi
      if [[ ${start:-0} -gt 0 ]]; then
        now=$(date +%s); elapsed=$((now - start))
        local m=$((elapsed / 60)); local s=$((elapsed % 60))
        if [[ $elapsed -ge 3600 ]]; then
          echo -e "  ${CYAN}Session:${NC}  $((elapsed/3600))h $(( (elapsed%3600)/60 ))m"
        else
          echo -e "  ${CYAN}Session:${NC}  ${m}m ${s}s"
        fi
      fi
    fi
  fi
  echo ""
}

output_tmux() {
  local json total
  json=$(fetch_balance)
  total=$(echo "$json" | json_val "balance_infos.0.total_balance")
  local status=""

  if [[ -n "$total" && "$total" != "0" ]]; then
    local color=green
    if node -e "process.exit(parseFloat('$total')>=5?0:1)" 2>/dev/null; then color=green
    elif node -e "process.exit(parseFloat('$total')>=1?0:1)" 2>/dev/null; then color=yellow
    else color=red; fi
    status+="#[fg=$color]\$$total"
  else
    status+="#[fg=red]offline"
  fi

  local pidfile="${TMPDIR:-/tmp}/deepcode-session.pid"
  if [[ -f "$pidfile" ]]; then
    local pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      local start=0 now elapsed
      if [[ -d "/proc/$pid" ]]; then
        start=$(stat -c %Y "/proc/$pid" 2>/dev/null || echo 0)
      elif [[ "$(uname -s)" == "Darwin" ]]; then
        start=$(ps -o lstart= -p "$pid" 2>/dev/null | xargs)
        [[ -n "$start" ]] && start=$(date -j -f "%a %b %d %T %Y" "$start" +%s 2>/dev/null) || start=0
      fi
      if [[ ${start:-0} -gt 0 ]]; then
        now=$(date +%s); elapsed=$((now - start))
        status+=" #[fg=cyan]$(($elapsed/60))m$(($elapsed%60))s"
      fi
    fi
  fi

  echo -n "$status"
}

# ---- Main -------------------------------------------------------------
case "${1:-}" in
  --tmux)   output_tmux ;;
  --watch)
    local i="${2:-5}"
    while true; do clear; output_default; sleep "$i"; done
    ;;
  --balance)
    fetch_balance | node -e "process.stdin.on('data',function(d){console.log(JSON.stringify(JSON.parse(d),null,2))})" 2>/dev/null || fetch_balance
    ;;
  --record-session)
    echo $$ > "${TMPDIR:-/tmp}/deepcode-session.pid"
    echo "Session recorded (PID $$)"
    ;;
  *)  output_default ;;
esac
