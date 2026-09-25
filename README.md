# 🎁 SrRobs Free Games

Bot Discord que **vigia a loja Steam** e publica no teu server os jogos que **estavam pagos e estão a 100% de graça** (promoções temporárias — eventos, fim-de-semana, flash deals). A licença resgatada **fica para sempre na biblioteca**, seja o jogo de 0,99€ ou de 60€.

**Sem ASF, sem farm, sem conta Steam.** O bot só anuncia — resgatas tu, com um clique.

```
Steam (pesquisa "specials", ordenada por preço)
        │  a cada 30 min
        ▼
┌──────────────────┐   🆕 jogo a 0,00€ (-100%)   ┌─────────┐
│   Bot Discord    │ ──────────────────────────► │ Discord │
│  (sem ligação    │   🗑️ promoção acabou →      │         │
│   à Steam)       │      apaga a mensagem       │         │
└──────────────────┘                             └─────────┘
```

## O que faz (e o que não faz)

- ✅ Deteta **jogos pagos a -100%** (0,00€) — a licença fica permanente na biblioteca ao resgatar.
- ✅ Deteta **jogos em promoção a ≤3€ cujas trading cards valem mais que o preço** (arbitragem: compras, farmas as cartas em 2-3h e vendes no mercado — o retorno estimado tem de recuperar o custo, configurável).
- ✅ Publica embed com **preço original** + botão **"Resgatar na Steam"** (ou "Comprar" + "Ver cartas no mercado" no modo cartas).
- ✅ **Nunca repete** uma oferta (dedupe por appid na BD).
- ✅ Quando a promoção acaba, **apaga a mensagem** do canal — o canal fica limpo, zero spam.
- ❌ Não reclama jogos, não farma cartas, não usa ASF nem conta Steam.

Os F2P permanentes (CS2, Dota 2…) **não são anunciados** — só jogos que estavam pagos.

## 1. Configuração rápida

```bash
git clone <o-teu-repo> srrobs && cd srrobs
npm install
npm run setup          # wizard: token/app ID do Discord, server, canal de ofertas
npm run invite         # link de convite do bot
npm run deploy-commands   # registar slash commands (uma vez)
npm start              # ou npm run start:all (com reinício automático)
```

Só precisas de: **DISCORD_TOKEN**, **DISCORD_APP_ID**, **GUILD_ID** e **DISCORD_LOG_CHANNEL_ID** (canal onde aparecem as ofertas).

## 2. Comandos no Discord

| Comando | O que faz |
|---|---|
| `/ofertas` | Promoções 100% ativas + o que acabou recentemente |
| `/status` | Estado do bot e da última verificação |
| `/verificar` | ⚙️ Força uma verificação agora (admin) |
| `/help` | Ajuda |

## 3. Como funciona o ciclo

- **A cada 30 min** (ajustável com `OFERTA_INTERVAL_MIN`) — pesquisa a loja Steam (`specials=1&sort_by=Price_ASC`): todos os jogos a 0,00€ com desconto de -100% estão nas primeiras páginas.
- Confirma cada resultado no `appdetails` da loja (evita falsos positivos) e só anuncia quem **tinha preço original > 0** — F2P de origem fica de fora.
- **Modo cartas:** os jogos em promoção a ≤ `CARTAS_PRECO_MAX_EUR` (3€) são consultados no mercado da Steam; se `drops estimados × preço médio das cartas ÷ 1.15` devolver ≥ custo do jogo + `CARTAS_LUCRO_MIN_PCT`%, publica a matemática completa (set, média por carta, retorno estimado e venda conservadora).
- Novidade → publica embed com botão de resgate. Nunca anuncia o mesmo jogo duas vezes.
- Jogo conhecido que **deixou** de cumprir os critérios → após 2 ciclos seguidos sem o ver (proteção contra falhas da Steam), **apaga a mensagem** e arquiva no histórico (`expirado_em`). Após 30 dias sai do histórico.

## 4. Instalar como serviço (Linux)

```bash
bash deploy/install.sh     # instala Node 20 + serviço systemd
sudo systemctl start srrobs
journalctl -u srrobs -f    # logs em vivo
```

## 5. Hospedagem barata

Como já não há ASF nem farming, qualquer coisa serve:

| Opção | Custo | Nota |
|---|---|---|
| **Oracle Cloud Free** | 0 €/mês | Always Free ARM chega com folga |
| **Netcup / Hetzner** | ~2-4 €/mês | IPv4 próprio |
| **Raspberry Pi em casa** | — | Consumo irrisório |

O bot usa ~100 MB de RAM. Nenhum endpoint da Steam usados precisa de API key nem de login.

## 6. FAQ

**O jogo fica na biblioteca para sempre?** Sim. Resgatar um jogo a -100% equivale a comprá-lo a 0€ — a licença é permanente.

**Porque desapareceu a mensagem do jogo X?** Porque a promoção acabou — o bot apaga-a para o canal só ter ofertas válidas. Vê o histórico com `/ofertas`.

**Anuncia jogos de qual valor?** Os -100% de qualquer valor. Os de cartas só até 3€ (`CARTAS_PRECO_MAX_EUR`) — acima disso a arbitragem raramente compensa.

**Como estima o retorno das cartas?** Conta nova dropa ~metade do set (ceil(nº cartas/2)). Multiplica pelo preço médio das cartas no mercado e divide por 1.15 (fee da Steam de 15%). Mostra também um valor conservador (só metade mais barata do set, com folga de 20%).

**E os jogos F2P?** Nunca anunciados — só pagos temporariamente a 0€.
