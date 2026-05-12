# Sumply

Web móvil de retos diarios inspirada en Sumplete 5x5, con estética basada en Cincoku.

Los retos diarios viven en `puzzles.json`. Cada reto define una matriz `values` y una matriz `solution`; la app calcula los objetivos de filas y columnas a partir de esa solución y valida que el puzzle no sea trivial.

## Probar en local

```bash
python3 -m http.server 4173
```

Después abre `http://localhost:4173/`.

## Juego

- Toca una celda una vez para tacharla.
- Tócala dos veces para marcarla como incluida.
- Las pistas de la derecha y de abajo muestran el objetivo.
- Si una pista se completa, puedes tocarla para marcar como válidos todos los números no tachados de esa fila o columna.
- Si los números marcados como incluidos suman exactamente una pista, puedes tocar esa pista para tachar el resto de la fila o columna.
- El reto se completa cuando todas las filas y columnas coinciden con sus pistas.
