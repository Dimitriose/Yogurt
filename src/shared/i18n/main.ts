// Strings for this namespace. `en` defines the shape; `pt` must match it.
//
// Main-process text that reaches the user: errors stored in the meeting or
// broadcast to the renderer, dialog titles, exported files and the error
// report. The model prompts live in `src/main/prompts.ts`, not here.
export const en = {
  apiErrors: {
    recovery:
      'Nothing was lost: the meeting audio is still saved. Once this is fixed, open the ' +
      'meeting and use "Retranscribe" or "Regenerate summary" from the menu.',
    quota:
      'Your OpenAI account is out of credits (or hit its monthly spending limit), so ' +
      'OpenAI stopped accepting requests. Ask whoever manages the account to add ' +
      'credits at platform.openai.com → Settings → Billing.',
    invalidKey:
      'OpenAI rejected the configured API key — it may be wrong, revoked, or belong ' +
      'to a deactivated project. Check it in Settings → OpenAI key.',
    forbidden:
      'OpenAI denied your account access to this resource (usually the chosen model ' +
      'is not enabled for it). Switch the model in Settings or ask whoever manages ' +
      'the account to enable it.',
    rateLimited:
      'OpenAI received too many requests in a short time and asked us to wait. ' +
      'Wait a few minutes and try again.',
    serverError:
      'OpenAI servers are unstable right now (an error on their side). ' +
      'Try again in a few minutes.',
    connection:
      'Could not reach OpenAI. Check your internet connection ' +
      '(and the VPN, if you use one).'
  },
  meetings: {
    /** Speaker label for the system channel when diarization is off. */
    defaultTitle: 'Untitled meeting',
    blockTruncated: (block: number, warning: string) => `Block ${block}: ${warning}`,
    blockFailed: (block: number, source: string, error: string) =>
      `Block ${block} (${source}) failed to transcribe: ${error}`,
    nothingToSummarize: 'Nothing was transcribed and there are no notes to summarize.',
    segmentsFailedTranscription: (n: number) =>
      n === 1
        ? '1 segment failed to transcribe.'
        : `${n} segments failed to transcribe.`,
    segmentsNotTranscribed: (n: number) =>
      n === 1 ? '1 segment was not transcribed.' : `${n} segments were not transcribed.`,
    audioRemoved: 'The audio for this meeting has already been removed from disk.',
    noSegments: 'No audio segments found.',
    interruptedRecording:
      'The meeting was interrupted before it finished. Use "Retranscribe" to process the recorded audio.',
    interruptedSummary: 'Summary generation was interrupted. Use "Regenerate summary".'
  },
  openai: {
    noApiKey: 'No OpenAI key configured. Open Settings and enter your API key.',
    truncationTokens: (used: number, limit: number) =>
      ` The response used ${used} of ${limit} output tokens.`,
    truncation: (missingSec: number, tokenNote: string) =>
      `The transcript for this block ends ${missingSec}s before the end of the audio, ` +
      `which usually means the response was cut off by the token limit.${tokenNote} ` +
      'Reducing the segment size in Settings fixes it.',
    requestTooLarge: (tpm: number) =>
      `The notes don't fit your OpenAI account's tokens-per-minute limit ` +
      `(${tpm} TPM). This meeting is too long for a single request. ` +
      `In Settings → Meeting, enter your account's correct limit so Yogurt ` +
      `condenses the transcript before sending it.`,
    emptySummary: 'The model returned empty meeting notes.'
  },
  export: {
    dialogTitle: 'Export meeting',
    defaultFileName: 'meeting',
    originalNotes: 'Original notes',
    transcript: 'Transcript'
  },
  errorReport: {
    heading: (version: string) => `Yogurt ${version} — error report`,
    meeting: 'Meeting',
    date: 'Date',
    generatedAt: 'Generated at',
    error: 'ERROR',
    incompleteBlocks: (n: number) => `INCOMPLETE BLOCKS (${n})`,
    mic: 'microphone',
    system: 'system',
    truncated: (covered: number, total: number) =>
      `truncated: covered ${covered}s of ${total}s`,
    outputTokens: (n: number) => `${n} output tokens`,
    block: (n: number) => `Block ${n}`,
    fileName: 'errors.txt'
  },
  settings: {
    encryptionUnavailable:
      'Windows did not provide encryption to store the key securely, ' +
      'so it was not saved. Try restarting Yogurt; if it persists, ' +
      'check that your Windows profile is loading normally.'
  }
}

export const pt: typeof en = {
  apiErrors: {
    recovery:
      'Nada foi perdido: o áudio da reunião continua salvo. Depois de resolver, abra a ' +
      'reunião e use "Retranscrever" ou "Regerar ata" no menu.',
    quota:
      'Os créditos da sua conta OpenAI acabaram (ou o limite de gasto mensal foi ' +
      'atingido), então a OpenAI parou de aceitar pedidos. Peça a quem administra ' +
      'a conta para adicionar créditos em platform.openai.com → Settings → Billing.',
    invalidKey:
      'A OpenAI recusou a chave de API configurada — ela pode estar errada, ter ' +
      'sido revogada ou pertencer a um projeto desativado. Confira em ' +
      'Configurações → Chave da OpenAI.',
    forbidden:
      'A OpenAI negou acesso a este recurso para a sua conta (geralmente o modelo ' +
      'escolhido não está liberado para ela). Troque o modelo em Configurações ou ' +
      'peça liberação a quem administra a conta.',
    rateLimited:
      'A OpenAI recebeu pedidos demais em pouco tempo e pediu para esperar. ' +
      'Aguarde alguns minutos e tente de novo.',
    serverError:
      'Os servidores da OpenAI estão instáveis no momento (erro do lado deles). ' +
      'Tente de novo em alguns minutos.',
    connection:
      'Não foi possível falar com a OpenAI. Verifique a conexão com a internet ' +
      '(e a VPN, se estiver usando).'
  },
  meetings: {
    defaultTitle: 'Reunião sem título',
    blockTruncated: (block, warning) => `Bloco ${block}: ${warning}`,
    blockFailed: (block, source, error) =>
      `Bloco ${block} (${source}) não transcreveu: ${error}`,
    nothingToSummarize: 'Nada foi transcrito e não há notas para resumir.',
    segmentsFailedTranscription: (n) => `${n} segmento(s) falharam na transcrição.`,
    segmentsNotTranscribed: (n) => `${n} segmento(s) não transcreveram.`,
    audioRemoved: 'O áudio desta reunião já foi removido do disco.',
    noSegments: 'Nenhum segmento de áudio encontrado.',
    interruptedRecording:
      'A reunião foi interrompida antes de terminar. Use "Retranscrever" para processar o áudio gravado.',
    interruptedSummary: 'A geração da ata foi interrompida. Use "Regerar ata".'
  },
  openai: {
    noApiKey: 'Nenhuma chave da OpenAI configurada. Abra Configurações e informe sua API key.',
    truncationTokens: (used, limit) =>
      ` A resposta usou ${used} de ${limit} tokens de saída.`,
    truncation: (missingSec, tokenNote) =>
      `A transcrição deste bloco termina ${missingSec}s antes do fim do áudio, ` +
      `o que costuma indicar resposta cortada pelo teto de tokens.${tokenNote} ` +
      'Reduzir o tamanho do segmento nas Configurações resolve.',
    requestTooLarge: (tpm) =>
      `A ata não cabe no limite de tokens por minuto da sua conta OpenAI ` +
      `(${tpm} TPM). Esta reunião é longa demais para um ` +
      `único envio. Em Configurações → Reunião, informe o limite correto da ` +
      `sua conta para o Yogurt condensar a transcrição antes de enviar.`,
    emptySummary: 'O modelo devolveu uma ata vazia.'
  },
  export: {
    dialogTitle: 'Exportar reunião',
    defaultFileName: 'reuniao',
    originalNotes: 'Notas originais',
    transcript: 'Transcrição'
  },
  errorReport: {
    heading: (version) => `Yogurt ${version} — relatório de erros`,
    meeting: 'Reunião',
    date: 'Data',
    generatedAt: 'Gerado em',
    error: 'ERRO',
    incompleteBlocks: (n) => `BLOCOS INCOMPLETOS (${n})`,
    mic: 'microfone',
    system: 'sistema',
    truncated: (covered, total) => `truncado: cobriu ${covered}s de ${total}s`,
    outputTokens: (n) => `${n} tokens de saída`,
    block: (n) => `Bloco ${n}`,
    fileName: 'erros.txt'
  },
  settings: {
    encryptionUnavailable:
      'O Windows não ofereceu criptografia para guardar a chave com segurança, ' +
      'então ela não foi salva. Tente reiniciar o Yogurt; se persistir, ' +
      'verifique se o perfil do Windows está carregado normalmente.'
  }
}
