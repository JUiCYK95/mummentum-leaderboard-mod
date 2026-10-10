# mummentum-leaderboard

Ein Claude-Code-Mod, der deinen Token-Verbrauch an das öffentliche
**mummentum Token-Leaderboard** meldet: https://mummentum-leaderboard.vercel.app

Je mehr Tokens Claude Code für dich verarbeitet (Input, Output und Cache
zusammen), desto höher dein Platz.

## Installation

In einer Claude-Code-Session **im Terminal** eingeben:

```
/plugin install mummentum-leaderboard --marketplace JUiCYK95/mummentum-leaderboard-mod
```

Die Frage „Add marketplace?“ mit `y` bestätigen, dann mit Enter den
User-Scope wählen. Der Mod ist sofort aktiv, auch in allen künftigen
Sessions und im Code-Tab der Claude-Desktop-App.

Voraussetzung ist eine aktuelle Claude-Code-Version (`claude update`).

## Was passiert

- Beim ersten Start trägt dich der Mod mit deinem `git config user.name` ein.
- Nach jedem Turn (auch von Subagents) addiert er die verbrauchten Tokens und
  meldet sie gesammelt, höchstens alle 15 Sekunden.
- Die Statuszeile zeigt deinen Platz, z. B. `🏆 #2 · 1,3 Mio. Tokens`.

Übertragen werden **nur Token-Zahlen, der Modellname und dein Git-Name**.
Keine Prompts, keine Antworten, keine Dateien.

## Befehle

| Befehl | Wirkung |
| --- | --- |
| `/leaderboard` | Zeigt deinen Platz, deine Tokens und den Link |
| `/leaderboard name Neuer Name` | Ändert deinen Anzeigenamen |
| `/leaderboard austreten` | Löscht deinen Eintrag; der Mod meldet danach nichts mehr |
| `/leaderboard beitreten` | Trägt dich wieder ein |

## Entwicklung

```
claude plugin validate .
claude plugin test .
```
