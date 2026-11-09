// Strings for this namespace. `en` defines the shape; `pt` must match it.
//
// Inline markup understood by the components' `rich()` helper:
// `**bold**`, `_emphasis_` and `` `code` ``.

export const en = {
  title: 'Settings',
  tabs: {
    api: 'API key',
    audio: 'Audio',
    meeting: 'Meeting'
  },

  apiKey: {
    heading: 'OpenAI key',
    intro:
      'Stored only on this machine, encrypted by Windows DPAPI. Audio is sent to the OpenAI API ' +
      'only at transcription time — Yogurt stores nothing in the cloud.',
    configured: 'key configured',
    none: 'no key configured',
    remove: 'Remove',
    test: 'Test',
    validating: 'Validating…',
    placeholder: 'sk-…',
    save: 'Save',
    savedValidating: 'Key saved and encrypted locally. Validating…',
    validReady: 'Valid key — all set.',
    valid: 'Valid key.',
    rejected: (error: string): string => `Key rejected: ${error}`,
    removed: 'Key removed.'
  },

  audio: {
    heading: 'Audio capture',
    system: 'System audio',
    systemHint:
      'Everything coming out of the speakers: the other people on Teams, Meet or Zoom. ' +
      'No screen image is recorded.',
    mic: 'Microphone',
    micHint: 'Your own voice, with echo cancellation so it does not duplicate the loopback.',
    micGain: (gain: string): string => `Microphone gain: ${gain}×`,
    systemGain: (gain: string): string => `System audio gain: ${gain}×`,
    sensitivity: 'Microphone sensitivity',
    sensitivityHint:
      'Where the line between noise and speech sits. It cannot be guessed: it depends on your ' +
      'microphone, your surroundings and how you speak.'
  },

  models: {
    heading: 'Models',
    transcription: 'Transcription',
    whisper: 'whisper-1 (with timestamps)',
    gpt4o: 'gpt-4o-transcribe (more accurate, no timestamps)',
    gpt4oMini: 'gpt-4o-mini-transcribe (cheaper)',
    transcriptionHint:
      'Only whisper-1 returns per-passage timestamps; the others produce one line per segment.',
    summary: 'Summary and title',
    summaryHint:
      'The tokens-per-minute ceiling is **per model**, not per account: on the first tier ' +
      'gpt-4o has 30,000 and luna has 200,000. Changing it here adjusts the limit below as ' +
      'well — otherwise Yogurt would condense the transcript because of a limit that no longer ' +
      'applies, and the summary would come out worse for no reason.',
    tpmAdjusted: (tpm: string, id: string): string =>
      `Limit adjusted to ${tpm} TPM, the first-tier value for ${id}. ` +
      `If your account tier is higher, correct it below.`,
    tpmKept: (id: string, tpm: string, current: string): string =>
      `${id} has ${tpm} TPM on the first tier. I kept your value of ${current}, ` +
      `which looks like it was set by hand.`,
    languageHeading: 'Language',
    languageAuto:
      '**Detected automatically**, block by block — there is nothing to configure. Each ' +
      'segment is an independent request, so a meeting that switches between Portuguese and ' +
      'English is transcribed faithfully in both.',
    languageRemoved:
      'There used to be a transcription-language selector here, and it was removed: the API ' +
      'parameter does not filter the audio, it tells the model which language the _output_ ' +
      'should be in. Setting a language different from the one spoken made Whisper ' +
      '**translate** instead of transcribe — and only partially, which is worse, because a ' +
      'half-translated transcript looks legitimate. Automatic detection already got it right ' +
      'on its own.',
    minutesLanguage:
      'The summary is written in the app language (Meeting › App language), whatever ' +
      'language the conversation was in.'
  },

  language: {
    heading: 'App language',
    auto: 'Automatic (system language)',
    en: 'English',
    pt: 'Português',
    hint: 'Applies to the app and to the generated summaries.'
  },

  speakers: {
    heading: 'Speaker identification',
    identify: 'Identify who spoke',
    identifyHint:
      'Switches transcription to `gpt-4o-transcribe-diarize`, which separates the speakers. ' +
      'Off by default because its quality in Portuguese compared with whisper-1 has not been ' +
      'measured yet — turn it on, compare, decide.',
    segmentReduced: (before: number, after: number): string =>
      `Segment size reduced from ${before} to ${after} min — the diarization model has 2,000 ` +
      `output tokens, and larger blocks can be cut off without warning.`,
    naming:
      'At the end of a meeting, in the **Speakers** tab, you give each voice a name — and you ' +
      'can name several labels at once by selecting their cards. Names apply **to this ' +
      'meeting only**: the labels the API returns (**A**, **B**…) are scoped per request and ' +
      'do not carry over between meetings.'
  },

  segment: {
    heading: 'Segment size',
    perBlock: (min: number): string => `${min} min per block`,
    hint:
      'Smaller segments make the transcript show up sooner and cost more calls. Larger ones ' +
      'are cheaper, but you wait longer to see the text — and they fragment the speaker ' +
      'labels less.',
    diarizedLimit: (max: number): string =>
      `Limited to ${max} min because speaker identification is on: the model has 2,000 ` +
      `output tokens, and going over that ceiling cuts off the end of the block without an ` +
      `error. If a truncation warning shows up during a meeting, reduce it further.`
  },

  tpm: {
    heading: 'Your OpenAI account limit',
    label: 'Tokens per minute (TPM)',
    hint:
      'This is the limit that breaks long meetings — and it belongs to your account, not the ' +
      'model. A 98-min meeting failed here with "Limit 30000, Requested 31406": the text fit ' +
      'easily in the gpt-4o window, but not under the account\'s per-minute ceiling. Knowing ' +
      'the value, Yogurt condenses the transcript before sending it instead of losing the ' +
      'summary at the end of the recording.',
    defaultHint:
      'The 30,000 default is the one for first-tier accounts. The number appears in the API ' +
      'error message, and Yogurt adopts it on its own when it finds it — you only need to ' +
      'change it here if you want to get ahead of that.'
  },

  detection: {
    heading: 'Meeting detection',
    label: 'Offer to record when a meeting starts',
    hint:
      'When Teams, Meet, Zoom or any app starts using the microphone, Yogurt asks whether you ' +
      'want to record. When they release the microphone, it asks whether to stop. It only ' +
      'suggests — it never starts or stops on its own.',
    note:
      'Detection reads the Windows microphone usage log, the same one that drives the privacy ' +
      'indicator — it does not listen to anything or inspect other apps. The suggestion to ' +
      'stop waits for 25s of free microphone, so that switching devices or rejoining the call ' +
      'does not trigger a false alarm.'
  },

  instructions: {
    heading: 'Instructions for the summary',
    intro:
      'Appended to the prompt for every meeting. Use it for your company\'s vocabulary, ' +
      'acronyms, or extra sections you always want.',
    placeholder:
      'E.g.: "ACME" = company name. Always include a "Financial impact" section when amounts ' +
      'are mentioned.'
  },

  data: {
    heading: 'Data',
    intro:
      'Audio, notes, transcripts and summaries are kept as readable files in the app\'s data ' +
      'folder. Deleting a meeting in Yogurt deletes its folder.',
    openFolder: 'Open data folder',
    version: (v: string): string =>
      `Installed version: **${v}**. When reporting a problem, include this number — it tells ` +
      `which build the problem happened in.`
  },

  window: {
    heading: 'Window',
    closeToTray: 'Closing hides to the tray',
    closeToTrayHint:
      'Clicking the X hides the window instead of quitting the app, and a recording in ' +
      'progress keeps going. To quit for good, right-click the tray icon and choose "Quit ' +
      'Yogurt". When off, the X quits the app — and a meeting in progress is lost.',
    note:
      'While recording, the tray icon gets a red dot and its tooltip shows the elapsed time. ' +
      'Yogurt also keeps the screen from sleeping while it records.'
  },

  speakerPanel: {
    identifiedAs: (name: string): string => `Identified as ${name}.`,
    empty:
      'This meeting has no speaker information. Record with channel separation (or with ' +
      'speaker identification on) and use "Retranscribe".',
    summary: (total: number, named: number, pending: number): string =>
      `**${total}** ${total === 1 ? 'voice' : 'voices'} in this meeting · **${named}** named ` +
      `by you · **${pending}** pending`,
    anonymousNote:
      'Anonymous labels (**A**, **B**…) only hold within each block — the **A** in block 1 ' +
      'may not be the **A** in block 2, so each one has to be named separately — but you can ' +
      'tick the cards that are the same person and name them all at once.',
    selectedCount: (n: number): string => `**${n}** selected`,
    clearSelection: 'Clear selection',
    bulkPlaceholder: 'Name for the selected',
    applying: 'Applying…',
    nameN: (n: number): string => `Name ${n}`,
    undo: 'Undo identification',
    bulkHint:
      'Tick the cards that are the same person — the sample text on each one helps you ' +
      'decide — and name them all at once.',
    selectAria: (speaker: string, block: number): string =>
      `Select ${speaker} from block ${block}`,
    self: 'Me (microphone)',
    anonTag: (speaker: string, block: number): string => `Speaker ${speaker} · block ${block}`,
    origin: (speaker: string, block: number): string => `was “${speaker}” in block ${block}`,
    stats: (lines: number, sec: number): string =>
      `${lines} ${lines === 1 ? 'utterance' : 'utterances'} · ${sec}s`,
    selectSame: (n: number, speaker: string): string => `Select the ${n} “${speaker}”`,
    notThis: (speaker: string): string => `Not ${speaker}? Correct it here`,
    orTypeAnother: 'Or type another name',
    whoIsIt: 'Who is this? (e.g. Peter)',
    saving: 'Saving…',
    identify: 'Identify',
    alwaysYou: 'Comes from the microphone channel, so it is always you.',
    regenNote: (n: number): string =>
      `${n} ${n === 1 ? 'name' : 'names'} assigned. The summary only uses them once it is ` +
      `rewritten.`,
    regenButton: 'Regenerate summary with the names'
  }
}

export const pt: typeof en = {
  title: 'Configurações',
  tabs: {
    api: 'Chave API',
    audio: 'Áudio',
    meeting: 'Reunião'
  },

  apiKey: {
    heading: 'Chave da OpenAI',
    intro:
      'Guardada apenas nesta máquina, criptografada pelo DPAPI do Windows. O áudio vai para ' +
      'a API da OpenAI só no momento da transcrição — nada é armazenado em nuvem pelo Yogurt.',
    configured: 'chave configurada',
    none: 'nenhuma chave configurada',
    remove: 'Remover',
    test: 'Testar',
    validating: 'Validando…',
    placeholder: 'sk-…',
    save: 'Salvar',
    savedValidating: 'Chave salva e criptografada localmente. Validando…',
    validReady: 'Chave válida — tudo pronto.',
    valid: 'Chave válida.',
    rejected: (error: string): string => `Chave rejeitada: ${error}`,
    removed: 'Chave removida.'
  },

  audio: {
    heading: 'Captura de áudio',
    system: 'Áudio do sistema',
    systemHint:
      'Tudo que sai pelos alto-falantes: as outras pessoas no Teams, Meet ou Zoom. ' +
      'Nenhuma imagem de tela é gravada.',
    mic: 'Microfone',
    micHint: 'Sua própria voz, com cancelamento de eco para não duplicar o loopback.',
    micGain: (gain: string): string => `Ganho do microfone: ${gain}×`,
    systemGain: (gain: string): string => `Ganho do áudio do sistema: ${gain}×`,
    sensitivity: 'Sensibilidade do microfone',
    sensitivityHint:
      'Onde fica a fronteira entre ruído e fala. Não dá para adivinhar: depende do seu ' +
      'microfone, do ambiente e de como você fala.'
  },

  models: {
    heading: 'Modelos',
    transcription: 'Transcrição',
    whisper: 'whisper-1 (com timestamps)',
    gpt4o: 'gpt-4o-transcribe (mais preciso, sem timestamps)',
    gpt4oMini: 'gpt-4o-mini-transcribe (mais barato)',
    transcriptionHint:
      'Só o whisper-1 devolve timestamps por trecho; os outros geram uma linha por segmento.',
    summary: 'Ata e título',
    summaryHint:
      'O teto de tokens por minuto é **por modelo**, não por conta: no primeiro nível o ' +
      'gpt-4o tem 30.000 e o luna tem 200.000. Trocar aqui ajusta o limite abaixo junto — sem ' +
      'isso o Yogurt condensaria a transcrição por causa de um limite que já não se aplica, e ' +
      'a ata sairia pior sem motivo.',
    tpmAdjusted: (tpm: string, id: string): string =>
      `Limite ajustado para ${tpm} TPM, o do ${id} no primeiro nível ` +
      `da conta. Se o seu nível for maior, corrija abaixo.`,
    tpmKept: (id: string, tpm: string, current: string): string =>
      `O ${id} tem ${tpm} TPM no primeiro nível. Mantive o seu ` +
      `valor de ${current}, que parece ter sido definido à mão.`,
    languageHeading: 'Idioma',
    languageAuto:
      '**Detectado automaticamente**, bloco por bloco — não há nada para configurar. Cada ' +
      'segmento é uma requisição independente, então uma reunião que alterna entre português ' +
      'e inglês é transcrita fielmente nos dois.',
    languageRemoved:
      'Havia um seletor de idioma aqui, e ele foi removido: o parâmetro da API não filtra o ' +
      'áudio, ele instrui o modelo sobre o idioma da _saída_. Informar um idioma diferente do ' +
      'falado fazia o Whisper **traduzir** em vez de transcrever — e de forma parcial, o que ' +
      'é pior, porque um transcript meio traduzido parece legítimo. A detecção automática já ' +
      'acertava sozinha.',
    minutesLanguage:
      'A ata sai no idioma do app (Reunião › Idioma do app), qualquer que seja o idioma da ' +
      'conversa.'
  },

  language: {
    heading: 'Idioma do app',
    auto: 'Automático (idioma do sistema)',
    en: 'English',
    pt: 'Português',
    hint: 'Vale para o app e para as atas geradas.'
  },

  speakers: {
    heading: 'Identificação de falantes',
    identify: 'Identificar quem falou',
    identifyHint:
      'Troca a transcrição para o `gpt-4o-transcribe-diarize`, que separa os falantes. Fica ' +
      'desligado por padrão porque a qualidade em português frente ao whisper-1 ainda não foi ' +
      'medida — ligue, compare, decida.',
    segmentReduced: (before: number, after: number): string =>
      `Tamanho do segmento reduzido de ${before} para ${after} min — o modelo de diarização ` +
      `tem 2.000 tokens de saída, e blocos maiores podem ser cortados sem avisar.`,
    naming:
      'Ao final de uma reunião, na aba **Falantes**, você dá nome a cada voz — e pode nomear ' +
      'vários rótulos de uma vez selecionando os cartões. Os nomes valem **nesta reunião**: ' +
      'os rótulos que a API devolve (**A**, **B**…) são escopados por requisição e não se ' +
      'repetem entre reuniões.'
  },

  segment: {
    heading: 'Tamanho do segmento',
    perBlock: (min: number): string => `${min} min por bloco`,
    hint:
      'Segmentos menores fazem a transcrição aparecer mais rápido e custam mais chamadas. ' +
      'Maiores são mais baratos, mas você espera mais para ver o texto — e fragmentam menos ' +
      'os rótulos de falante.',
    diarizedLimit: (max: number): string =>
      `Limitado a ${max} min porque a identificação de falantes está ligada: o modelo tem ` +
      `2.000 tokens de saída, e estourar esse teto corta o fim do bloco sem dar erro. Se ` +
      `aparecer aviso de truncamento durante uma reunião, reduza mais.`
  },

  tpm: {
    heading: 'Limite da sua conta OpenAI',
    label: 'Tokens por minuto (TPM)',
    hint:
      'É o limite que quebra reuniões longas — e ele é da sua conta, não do modelo. Uma ' +
      'reunião de 98 min falhou aqui com "Limit 30000, Requested 31406": o texto cabia ' +
      'folgado na janela do gpt-4o, mas não no teto por minuto da conta. Sabendo o valor, o ' +
      'Yogurt condensa a transcrição antes de enviar em vez de perder a ata no fim da ' +
      'gravação.',
    defaultHint:
      'O padrão de 30.000 é o das contas de primeiro nível. O número aparece na mensagem de ' +
      'erro da API, e o Yogurt o adota sozinho quando o encontra — você só precisa mexer ' +
      'aqui se quiser antecipar.'
  },

  detection: {
    heading: 'Detecção de reuniões',
    label: 'Sugerir gravar quando uma reunião começar',
    hint:
      'Quando Teams, Meet, Zoom ou qualquer app passa a usar o microfone, o Yogurt pergunta ' +
      'se você quer gravar. Ao soltarem o microfone, pergunta se deve encerrar. Ele apenas ' +
      'sugere — nunca começa nem para por conta própria.',
    note:
      'A detecção lê o registro de uso de microfone do Windows, o mesmo que alimenta o ' +
      'indicador de privacidade — não escuta nada nem inspeciona outros apps. A sugestão de ' +
      'encerrar espera 25s de microfone livre, para trocar de dispositivo ou reabrir a ' +
      'chamada não disparar um falso alarme.'
  },

  instructions: {
    heading: 'Instruções para a ata',
    intro:
      'Anexado ao prompt em toda reunião. Use para o vocabulário da sua empresa, siglas, ou ' +
      'seções extras que você sempre quer.',
    placeholder:
      'Ex.: "ACME" = nome da empresa. Sempre inclua uma seção "Impacto financeiro" quando ' +
      'valores forem citados.'
  },

  data: {
    heading: 'Dados',
    intro:
      'Áudio, notas, transcrições e atas ficam em arquivos legíveis na pasta de dados do ' +
      'app. Apagar uma reunião no Yogurt apaga a pasta dela.',
    openFolder: 'Abrir pasta de dados',
    version: (v: string): string =>
      `Versão instalada: **${v}**. Ao relatar um problema, informe este número — ele diz em ` +
      `qual build o problema aconteceu.`
  },

  window: {
    heading: 'Janela',
    closeToTray: 'Fechar esconde na bandeja',
    closeToTrayHint:
      'Clicar no X esconde a janela em vez de encerrar o app, e a gravação em curso ' +
      'continua. Para fechar de vez, clique com o botão direito no ícone da bandeja e ' +
      'escolha "Sair do Yogurt". Desligado, o X encerra o app — e uma reunião em ' +
      'andamento é perdida.',
    note:
      'Durante a gravação o ícone da bandeja ganha um ponto vermelho, e o tooltip mostra o ' +
      'tempo corrido. O Yogurt também impede a tela de suspender enquanto grava.'
  },

  speakerPanel: {
    identifiedAs: (name: string): string => `Identificado como ${name}.`,
    empty:
      'Esta reunião não tem informação de falante. Grave com a separação de canais (ou com a ' +
      'identificação de falantes ligada) e use "Retranscrever".',
    summary: (total: number, named: number, pending: number): string =>
      `**${total}** vozes nesta reunião · **${named}** nomeadas por você · ` +
      `**${pending}** pendentes`,
    anonymousNote:
      'Os rótulos anônimos (**A**, **B**…) valem só dentro de cada bloco — o **A** do bloco 1 ' +
      'pode não ser o **A** do bloco 2, então cada um precisa ser nomeado à parte — mas você ' +
      'pode marcar os cartões que são a mesma pessoa e nomear todos de uma vez.',
    selectedCount: (n: number): string => `**${n}** selecionado(s)`,
    clearSelection: 'Limpar seleção',
    bulkPlaceholder: 'Nome para os selecionados',
    applying: 'Aplicando…',
    nameN: (n: number): string => `Nomear ${n}`,
    undo: 'Desfazer identificação',
    bulkHint:
      'Marque os cartões que são a mesma pessoa — o texto de exemplo em cada um ajuda a ' +
      'decidir — e nomeie todos de uma vez.',
    selectAria: (speaker: string, block: number): string =>
      `Selecionar ${speaker} do bloco ${block}`,
    self: 'Eu (microfone)',
    anonTag: (speaker: string, block: number): string => `Falante ${speaker} · bloco ${block}`,
    origin: (speaker: string, block: number): string => `era “${speaker}” no bloco ${block}`,
    stats: (lines: number, sec: number): string => `${lines} falas · ${sec}s`,
    selectSame: (n: number, speaker: string): string => `Selecionar os ${n} “${speaker}”`,
    notThis: (speaker: string): string => `Não é ${speaker}? Corrija aqui`,
    orTypeAnother: 'Ou digite outro nome',
    whoIsIt: 'Quem é? (ex.: Pedro)',
    saving: 'Salvando…',
    identify: 'Identificar',
    alwaysYou: 'Vem do canal do microfone, então é sempre você.',
    regenNote: (n: number): string =>
      `${n} nome(s) atribuído(s). A ata só passa a usá-los quando for reescrita.`,
    regenButton: 'Regerar ata com os nomes'
  }
}
