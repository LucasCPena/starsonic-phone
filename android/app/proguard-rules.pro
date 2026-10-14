# Regras do R8 para o build de release (além das do proguard-android-optimize.txt, que já mantêm os
# nomes dos métodos native, como os de br.com.starsonic.phone.Native).

# O áudio Oboe do PJSIP (pjmedia/src/pjmedia-audiodev/oboe_dev.cpp) procura esta classe, os seus
# métodos e os seus campos pelo nome, via JNI: o R8 não pode apagá-la (nada no Kotlin a usa) nem
# renomear nada nela.
-keep class org.pjsip.PjAudioDevInfo { *; }
