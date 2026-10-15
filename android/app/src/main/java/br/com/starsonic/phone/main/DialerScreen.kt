package br.com.starsonic.phone.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import br.com.starsonic.phone.R

/** As teclas do Teclado e do teclado da ligação (DTMF), em linhas. */
internal val KEYS = listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("*", "0", "#"))

/**
 * O Teclado (spec 4.1): o número digitado (com o apagar), as teclas 0–9, * e # e o Ligar. [onDial] liga e diz
 * se ligou (sem registro, não liga, e a tela principal mostra o aviso); ligou, o número sai do campo. Rola em
 * telas baixas (o tamanho da letra segue o do celular).
 */
@Composable
fun DialerScreen(onDial: (String) -> Boolean) {
    var number by rememberSaveable { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.width(48.dp))
            Text(
                text = number,
                style = MaterialTheme.typography.headlineMedium,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).testTag("numero"),
            )
            IconButton(
                onClick = { number = number.dropLast(1) },
                enabled = number.isNotEmpty(),
                modifier = Modifier.testTag("apagar"),
            ) {
                Icon(painterResource(R.drawable.ic_apagar), contentDescription = ERASE)
            }
        }
        Keypad(onKey = { number += it })
        Button(
            onClick = { if (onDial(number)) number = "" },
            enabled = number.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = CallGreen, contentColor = Color.White),
            modifier = Modifier.fillMaxWidth().height(52.dp).testTag("ligar"),
        ) {
            Icon(painterResource(R.drawable.ic_ligar), contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(DIAL, style = MaterialTheme.typography.titleMedium)
        }
    }
}

/** O teclado de 12 teclas; [keyColor] é a cor do texto das teclas e [keySize], o tamanho de cada uma. */
@Composable
internal fun Keypad(
    onKey: (String) -> Unit,
    tagPrefix: String = "tecla-",
    keyColor: Color = Color.Unspecified,
    keySize: Dp = 60.dp,
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (row in KEYS) {
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                for (key in row) {
                    TextButton(
                        onClick = { onKey(key) },
                        shape = CircleShape,
                        modifier = Modifier.size(keySize).testTag(tagPrefix + key),
                    ) {
                        Text(key, style = MaterialTheme.typography.headlineMedium, color = keyColor)
                    }
                }
            }
        }
    }
}

private const val DIAL = "Ligar"
private const val ERASE = "Apagar"
