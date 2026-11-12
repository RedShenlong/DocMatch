# Datos de entrenamiento y sus licencias

| Fuente | Uso | Licencia | Notas |
|---|---|---|---|
| Formularios sintéticos generados por `packages/fixtures` (`training.ts`) | entrenamiento y hold-out | Apache-2.0 (propios) | Formularios administrativos **ficticios** con estilos variados (tipografía, cabeceras, cajas o subrayados, etiquetas a la izquierda o encima, 1–2 páginas). Cada familia incluye una «prima» (mismo diseño, otro título/finalidad). Relleno con datos ficticios a máquina y a mano. |
| Documentos ajenos sintéticos (facturas, nóminas, contratos, certificados, cartas, recibos, certificados de matrimonio) | entrenamiento (clases propias) y banco de negativos | Apache-2.0 (propios) | Generados por `packages/fixtures/src/foreign.ts`. |
| Fuentes manuscritas: Indie Flower, Reenie Beanie, Shadows Into Light (SIL OFL 1.1), Homemade Apple (Apache-2.0) | simular relleno a mano | OFL 1.1 / Apache-2.0 | Solo se usan para generar imágenes; no se redistribuyen dentro del modelo. Licencias en `packages/fixtures/fonts/`. |

**No se ha usado ningún dataset público de documentos.** Se valoraron RVL-CDIP, FUNSD, DocLayNet y
similares, pero o bien sus términos no son claramente compatibles con publicar los pesos bajo Apache-2.0,
o bien contienen documentos con datos de personas reales. Siguiendo la regla del proyecto («si hay dudas,
no se usa»), el modelo se entrena solo con datos sintéticos propios.

**Pesos preentrenados**: los pesos ImageNet de torchvision se entrenaron con ImageNet, cuyos términos de
acceso restringen el uso a investigación no comercial. Por prudencia, el modelo publicado se entrena desde
cero (`Encoder(pretrained=False)`). `train.py --pretrained` existe solo para experimentar.
