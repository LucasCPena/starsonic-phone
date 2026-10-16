# Regras do R8 para o build de release (além das do proguard-android-optimize.txt, que já mantêm os
# nomes dos métodos native, como os de br.com.starsonic.phone.Native).

# O áudio Oboe do PJSIP (pjmedia/src/pjmedia-audiodev/oboe_dev.cpp) procura esta classe, os seus
# métodos e os seus campos pelo nome, via JNI: o R8 não pode apagá-la (nada no Kotlin a usa) nem
# renomear nada nela.
-keep class org.pjsip.PjAudioDevInfo { *; }

# A ponte JNI (src/main/cpp/jni_bridge.cpp) entrega os avisos do motor chamando estes métodos pelo nome:
# o R8 não vê esse uso e não pode apagá-los nem renomeá-los.
-keepclassmembers class br.com.starsonic.phone.engine.EngineSink {
    public void onRegistration(int, boolean, int);
    public void onIncomingCall(int, java.lang.String, java.lang.String);
    public void onRejectedBusy(java.lang.String, java.lang.String);
    public void onCallState(int, int, int);
    public void onTransfer(int, int);
    public void onLog(int, java.lang.String);
}
