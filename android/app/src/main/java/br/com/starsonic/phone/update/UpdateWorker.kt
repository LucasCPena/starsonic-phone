package br.com.starsonic.phone.update

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import br.com.starsonic.phone.App

/** A verificação de 24 h (esboço). */
class UpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = Result.success()

    companion object {
        const val NAME = "atualizacao"

        fun schedule(context: Context) {}

        fun check(app: App): Decision = Decision.NONE
    }
}
