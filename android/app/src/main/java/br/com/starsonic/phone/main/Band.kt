package br.com.starsonic.phone.main

import androidx.compose.ui.graphics.Color

// As cores do visual antigo que a tela de chamada (CallScreen) ainda usa, até ela passar para o visual do Windows
// (Task 6, que apaga este arquivo). As outras telas usam as do ui/StarsonicTheme.

internal val StarsonicBlue = Color(0xFF383881)
internal val StarsonicCyan = Color(0xFF3DB1CC)

/** Ligar e Atender (Global Constraints: verde). */
internal val CallGreen = Color(0xFF2E9E4F)

/** Recusar e Desligar (Global Constraints: vermelho). */
internal val CallRed = Color(0xFFD93025)
