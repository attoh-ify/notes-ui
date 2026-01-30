(function () {
  let origin = window.location.origin;
  let wsprotocol = window.location.protocol === "https:" ? "wss" : "ws";
  let host = window.location.host;

  let noteId = null;
  let userId = null;

  document.getElementById("editor").oninput = onChangeText;
  document.getElementById("editor").onpaste = onPaste;

  let docState = new DocState((newDoc) => {
    document.getElementById("editor").value = newDoc;
  });

  function getCaretPosition(textarea) {
    if (document.selection) {
      textarea.focus();
      var range = document.selection.createRange();
      var rangeLen = range.text.length;
      range.moveStart("character", -textarea.value.length);
      var start = range.text.length - rangeLen;
      return {
        start: start,
        end: start + rangeLen,
      };
    } else if (textarea.selectionStart || textarea.selectionStart === "0") {
      return {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      };
    } else {
      return {
        start: 0,
        end: 0,
      };
    }
  }

  function onOperationAcknowledged(operation, revision) {
    if (docState.lastSyncedRevision < revision) {
      docState.acknowledgeOperation(operation, revision, (pendingOperation) => {
        sendOperation(pendingOperation, docState.lastSyncedRevision);
      });
    }
  }

  function handleOperation(payload) {
    let ack = payload.acknowledgeTo;
    let operation = payload.operation;
    let revision = payload.revision;

    if (ack === userId) {
      onOperationAcknowledged(operation, revision);
    } else {
      docState.transformPendingOperations(operation, revision);
      docState.lastSyncedRevision = revision;

      // transformedOperation = docState.transformOperationAgainstSentOperation(operation)
      transformedOperation =
        docState.transformOperationAgainstLocalChanges(operation);

      if (transformedOperation === null) return;

      if (transformedOperation.opName === "INS") {
        onInsert(
          transformedOperation.operand,
          transformedOperation.position,
          revision,
        );
      } else if (transformedOperation.opName === "DEL") {
        onDelete(
          transformedOperation.operand,
          transformedOperation.position,
          revision,
        );
      }
    }
  }

  function handleCollaboratorCount(payload) {
    let count = payload.count;
    setCollaboratorCount(count);
  }

  function setCollaboratorCount(count) {
    let collaboratorCount = count - 1;
    let text = "";
    if (collaboratorCount === 1) {
      text = "You +1 collaborator";
    } else if (collaboratorCount > 1) {
      text = `You + ${collaboratorCount} collaborators`;
    }
    document.getElementById("collaborator_count").innerText = text;
  }

  function subscribeToDocumentUpdates(client, noteId) {
    client.subscribe(`/topic/note/${noteId}`, function (message) {
      let body = message.body;
      let parsed = JSON.parse(body);
      console.log(parsed);

      let type = parsed.type;
      let payload = parsed.payload;

      switch (type) {
        case "OPERATION":
          handleOperation(payload);
          break;
        case "COLLABORATOR_COUNT":
          handleCollaboratorCount(payload);
          break;
      }
    });
  }

  async function onNewDocument(client) {
    console.log("On create doc user id:", userId);
    let response = await axios.post(`${origin}/api/notes`);
    console.log("create document response: " + response);
    let data = response.data;
    noteId = data.id;
    userId = data.userId;

    document.getElementById("shareable_link").textContent =
      `${origin}?noteId=${noteId}`;
    subscribeToDocumentUpdates(client, noteId);
  }

  async function onDocumentJoin(client, id) {
    let response = await axios.post(`${origin}/api/notes/${id}/join`);
    let data = response.data;
    let hasError = data.hasError;

    if (hasError) {
      throw "No such document";
    }

    noteId = id;
    docState.lastSyncedRevision = data.documentRevision;
    docState.setDocumentText(data.text || "");

    document.getElementById("editor").value = docState.document;
    document.getElementById("shareable_link").textContent =
      `${origin}?noteId=${noteId}`;
    setCollaboratorCount(data.collaboratorCount);

    subscribeToDocumentUpdates(client, noteId);
  }

  async function onConnect(client, id) {
    if (!id) {
      await onNewDocument(client); // new document
    } else {
      await onDocumentJoin(client, id); // join document with noteId=id
    }
  }

  function connectOrJoin() {
    let currUrl = window.location.search;
    let urlParams = new URLSearchParams(currUrl);
    let noteId = urlParams.get("noteId");

    let url = `${wsprotocol}://${host}/relay?noteId=${noteId}`;

    let socket = new SockJS(url);
    let client = Stomp.over(socket);

    client.debug = (str) => console.log("[STOMP]", str);
    console.log("user-name", userId);

    client.connect(
      {},
      (frame) => {
        userId = crypto.randomUUID(); // frame.headers["user-name"]
        onConnect(client, noteId);
      },
      (err) => {
        console.error("Connection error", err);
      },
    );
  }

  function onPaste(param) {
    let editor = document.getElementById("editor");
    let { start, end } = getCaretPosition(editor);
    let pastedText = param.clipboardData.getData("text");

    // delete selection
    if (start !== end) {
      let substr = editor.value.substring(start, end);
      sendDeleteOperation(start, substr);
    }
    // insert pasted text
    sendInsertOperation(start + 1, pastedText);
  }

  function onChangeText(event) {
    let inputType = event.inputType;

    let editor = document.getElementById("editor");
    let currText = editor.value;
    let prevText = docState.document;
    let { start, end } = getCaretPosition(editor);

    if (inputType === "insertText" || inputType === "insertCompositionText") {
      // delete the selected text
      if (currText.length <= prevText.length) {
        let charsToDeleteAfterStart = prevText.length - currText.length;
        let substr = prevText.substring(
          start - 1,
          start + charsToDeleteAfterStart,
        );
        sendDeleteOperation(start - 1, substr);
      }
      // insert the typed character
      sendInsertOperation(start, currText.substring(start - 1, start));
    } else if (inputType === "insertLineBreak") {
      sendInsertOperation(start, currText.substring(start - 1, start));
    } else if (
      inputType === "deleteByCut" ||
      inputType === "deleteContentBackward" ||
      inputType === "deleteContentForward"
    ) {
      let charactersDeleted = prevText.length - currText.length;
      let deletedString = prevText.substring(start, start + charactersDeleted);
      sendDeleteOperation(start, deletedString);
    } else {
      // unsupported operation
    }
  }

  function createOperationPayload(operation, revision) {
    return {
      operation: {
        opName: operation.opName,
        operand: operation.operand,
        position: operation.position,
      },
      revision: revision,
      from: userId,
    };
  }

  async function sendOperation(operation, revision) {
    if (operation.opName === "INS" || operation.opName === "DEL") {
      let body = createOperationPayload(operation, revision);

      await axios.post(`${origin}/api/notes/enqueue/${noteId}`, body);
    } else {
      // unsupported operation
    }
  }

  function sendInsertOperation(caretPosition, substring) {
    docState.queueOperation(
      new TextOperation(
        "INS",
        substring,
        caretPosition - 1,
        docState.lastSyncedRevision,
      ),

      (currDoc) => insertSubstring(currDoc, substring, caretPosition - 1),

      async (operation, revision) => {
        await sendOperation(operation, revision);
      },
    );
  }

  function sendDeleteOperation(caretPosition, substring) {
    docState.queueOperation(
      new TextOperation(
        "DEL",
        substring,
        caretPosition,
        docState.lastSyncedRevision,
      ),

      (currDoc) =>
        removeSubstring(
          currDoc,
          caretPosition,
          caretPosition + substring.length,
        ),

      async (operation, revision) => {
        await sendOperation(operation, revision);
      },
    );
  }

  function insertSubstring(mainString, substring, pos) {
    if (typeof pos == "undefined") {
      pos = 0;
    }
    if (typeof substring == "undefined") {
      substring = "";
    }
    return mainString.slice(0, pos) + substring + mainString.slice(pos);
  }

  function removeSubstring(str, start, end) {
    return str.substring(0, start) + str.substring(end);
  }

  function onInsert(charSequence, position, revision) {
    docState.setDocumentText(
      insertSubstring(docState.document, charSequence, position),
    );

    let editor = document.getElementById("editor");
    editor.value = docState.document;

    editor.style.height = "auto";
    let scrollHeight = editor.scrollHeight;
    editor.style.height = `${scrollHeight}px`;
  }

  function onDelete(charSequence, position, revision) {
    docState.setDocumentText(
      removeSubstring(
        docState.document,
        position,
        charSequence.length + position,
      ),
    );

    let editor = document.getElementById("editor");
    editor.value = docState.document;

    editor.style.height = "auto";
    let scrollHeight = editor.scrollHeight;
    editor.style.height = `${scrollHeight}px`;
  }

  try {
    connectOrJoin();
  } catch (e) {
    document.getElementById("hero").innerHTML = `<p>error loading page</p>`;
  }
}).call(this);
