// ── 빌드/버전 식별자 (배포 시마다 고유) ──
var __BUILD_ID__ = "ai-assistant-20260205-1500-btn0";
console.log("[AI Assistant][BOOT]", __BUILD_ID__, "href=", location.href);

// ── 로드된 스크립트 목록 (실제 서버 파일 경로 증명) ──
var __scripts__ = Array.from(document.scripts).map(function (s) { return s.src; }).filter(Boolean);
console.log("[AI Assistant][SCRIPTS]", __BUILD_ID__, __scripts__.filter(function (s) { return s.includes("code.js"); }));

// ── 런타임 에러 캐치 ──
window.addEventListener("error", function (e) {
  console.error("[code.js error]", e.message, e.error);
});
window.addEventListener("unhandledrejection", function (e) {
  console.error("[code.js rejection]", e.reason);
});

// ── debugCCCount / verifyContentControls 전역 등록 (IIFE 밖) ──
// globalThis 사용 → window가 아닌 진짜 전역 객체에 반드시 바인딩
globalThis.debugCCCount = function debugCCCount() {
  Asc.plugin.callCommand(function () {
    // callCommand 내부: injected global Api를 직접 사용 (AscCommon 사용 안 함)
    const ccs = Api.GetAllContentControls() || [];
    return { count: ccs.length, items: ccs.map((c, i) => ({ i, id: c.Id, tag: c.Tag, alias: c.Alias, title: c.Title })) };
  }, function (res) {
    console.log("[debugCCCount]", res);
    if (res?.items) console.table(res.items);
  });
};

globalThis.verifyContentControls = function verifyContentControls() {
  Asc.plugin.callCommand(function () {
    const ccs = Api.GetAllContentControls() || [];
    return { count: ccs.length, items: ccs.map((c, i) => ({ i, id: c.Id, tag: c.Tag, alias: c.Alias, title: c.Title })) };
  }, function (res) {
    console.log("[verifyContentControls]", res);
    if (res?.items) console.table(res.items);
  });
};

// ── 전역 마커 심기 (어떤 iframe에서든 마커 존재 여부로 플러그인 확인 가능) ──
globalThis.__AI_ASSISTANT__ = {
  buildId: __BUILD_ID__,
  href: location.href,
  exports: {
    debugCCCount: typeof globalThis.debugCCCount,
    verifyContentControls: typeof globalThis.verifyContentControls
  }
};

// ── EXPORT 증거 로그 (function이 아니면 즉시 FAIL_EXPORT 발생) ──
console.log("[AI Assistant][EXPORT]", __BUILD_ID__, {
  debugCCCount: typeof globalThis.debugCCCount,
  verifyContentControls: typeof globalThis.verifyContentControls
});

if (typeof globalThis.debugCCCount !== "function") {
  console.error("[AI Assistant][FAIL_EXPORT]", __BUILD_ID__, "debugCCCount not function. WRONG FRAME or WRONG FILE LOADED");
  console.error("[AI Assistant][FAIL_EXPORT_CTX]", __BUILD_ID__, { href: location.href, scriptsCount: __scripts__.length });
}

(function (window, undefined) {
  // ── 실행 컨텍스트 확인 로그 (IIFE 진입 시점) ──
  console.log("[AI Assistant][CTX]", __BUILD_ID__, {
    hasAscPlugin: !!(window.Asc && window.Asc.plugin),
    hasApiGlobal: typeof Api !== "undefined",
    hasAscCommon: !!window.AscCommon
  });
  console.log("[AI Assistant][PLUGIN_INFO]", __BUILD_ID__, (window.Asc && window.Asc.plugin && window.Asc.plugin.info) || "Asc.plugin.info not available yet");

  // ============================================
  // State
  // ============================================
  var socket        = null;
  var documentKey   = null;
  var reconnectAttempts = 0;
  var isPluginReady = false;

  // SSE: 기본 OFF.  실시간 필요 시 콘솔에서 toggleSSE(true) 호출
  var sseEnabled    = false;
  var MAX_SSE_RETRIES = 1; // 최대 1회 재시도 후 자동 OFF

  var NEXT_URL = "http://localhost:3000";

  // ============================================
  // callCommand 안전 래퍼
  // ────────────────────────────────────────────
  // 규칙:
  //   • Api.* 호출은 이 함수 내부에서만 발생
  //   • 첫 줄에서 typeof Api 체크 → undefined이면 즉시 return
  //   • 외부 변수 주입은 body 문자열에 JSON.stringify로 리터럴 주입 후
  //     new Function(body) 로 함수 생성 → callCommand에 전달
  //   • 외부 변수 불필요한 경우는 함수 리터럴 직접 전달 가능
  //     (단, closure 변수는 editor iframe에서 접근 불가)
  // ============================================
  // 공통: Api undefined 방어 프로로그 (body 문자열 앞에 반드시 삽입)
  var API_GUARD = [
    'if (typeof Api === "undefined") {',
    '  return JSON.stringify({error: "Api is undefined in editor iframe"});',
    '}',
  ].join('');

  // ============================================
  // Plugin Init
  // ============================================
  window.Asc.plugin.init = function (initData) {
    console.log("[AI Assistant] init, initData:", JSON.stringify(initData, null, 2));
    isPluginReady = true;

    getDocumentKeyAsync();

    // 3초 후 CC 진단 자동 실행
    setTimeout(function () {
      if (isPluginReady) diagnoseCCs();
    }, 3000);
  };

  // ── 글로벌 테스트 핸들 ──
  // debugCCCount は IIFE 밖에서 직접 등록済み
  globalThis.diagnoseCCs     = diagnoseCCs;
  globalThis.applyFillsBatch = applyFillsBatch;
  globalThis.toggleSSE       = function (flag) {
    sseEnabled = !!flag;
    console.log("[AI Assistant] SSE " + (sseEnabled ? "ON" : "OFF"));
    if (sseEnabled && documentKey) connectSSE(documentKey);
  };

  // ============================================
  // Document Key 획득
  // ============================================
  function getDocumentKeyAsync() {
    if (!isPluginReady) return;

    console.log("[Document Key] 시작");

    // (1) plugin.info 전체 로깅
    if (window.Asc && window.Asc.plugin && window.Asc.plugin.info) {
      console.log("[Document Key] Asc.plugin.info:", JSON.stringify(window.Asc.plugin.info, null, 2));
    }

    // (2) GetDocumentInfo API
    if (window.Asc && window.Asc.plugin && typeof window.Asc.plugin.executeMethod === "function") {
      window.Asc.plugin.executeMethod("GetDocumentInfo", [], function (docInfo) {
        console.log("[Document Key] GetDocumentInfo response:", JSON.stringify(docInfo, null, 2));

        if (docInfo) {
          var key = docInfo.key || docInfo.documentKey || docInfo.docId || docInfo.id;
          if (key) {
            documentKey = key;
            console.log("[Document Key] ✅ from GetDocumentInfo:", key);
            connectSSE(documentKey);
            return;
          }
        }
        // key 필드 없음 → identifier로 server 해시
        extractIdentifierAndHash(docInfo);
      });
    } else {
      extractIdentifierAndHash(null);
    }
  }

  function extractIdentifierAndHash(docInfo) {
    var id = null;

    if (docInfo)           id = docInfo.url || docInfo.title || docInfo.name || docInfo.path;
    if (!id && window.Asc && window.Asc.plugin && window.Asc.plugin.info) {
      var info = window.Asc.plugin.info;
      id = info.documentUrl || info.url || info.title || info.fileName || info.name;
    }
    if (!id) {
      var up = new URLSearchParams(window.location.search);
      id = up.get("url") || up.get("title") || up.get("filename");
    }
    if (!id) id = window.location.href;

    console.log("[Document Key] identifier:", id);

    fetch(NEXT_URL + "/api/document/get-key", {
      method:  "POST",
      headers: {"Content-Type": "application/json"},
      body:    JSON.stringify({identifier: id})
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (!data.documentKey) throw new Error("no documentKey");
      documentKey = data.documentKey;
      console.log("[Document Key] ✅ stable key:", documentKey);
      connectSSE(documentKey);
    })
    .catch(function (err) {
      console.error("[Document Key] get-key 실패:", err);
      documentKey = "session_" + Date.now();
      console.warn("[Document Key] ⚠️ session-only 키:", documentKey);
      connectSSE(documentKey);
    });
  }

  // ============================================
  // SSE (기본 OFF, 최대 1회 재시도)
  // ============================================
  function connectSSE(docKey) {
    if (!sseEnabled) {
      console.log("[SSE] OFF (default). 실시간 필요 시: toggleSSE(true)");
      return;
    }

    var url = NEXT_URL + "/api/sse/document/" + docKey;
    console.log("[SSE] 연결 시도:", url);

    try {
      socket = new EventSource(url);

      socket.onopen = function () {
        console.log("[SSE] ✅ 연결");
        reconnectAttempts = 0;
      };

      socket.onmessage = function (ev) {
        try {
          var patch = JSON.parse(ev.data);
          if (patch.type !== "connected") handlePatch(patch);
        } catch (e) { console.error("[SSE] parse error:", e); }
      };

      socket.onerror = function () {
        console.warn("[SSE] error");
        if (socket) { socket.close(); socket = null; }

        if (reconnectAttempts < MAX_SSE_RETRIES) {
          reconnectAttempts++;
          console.log("[SSE] retry " + reconnectAttempts + "/" + MAX_SSE_RETRIES);
          setTimeout(function () { connectSSE(docKey); }, 3000);
        } else {
          sseEnabled = false;
          console.log("[SSE] ❌ 최대 재시도 초과 → OFF. 플러그인은 계속 작동.");
        }
      };
    } catch (e) {
      console.error("[SSE] EventSource 생성 실패:", e);
      sseEnabled = false;
    }
  }

  // ============================================
  // Patch 라우팅
  // ============================================
  function handlePatch(patch) {
    if (!isPluginReady) return;
    console.log("[AI Assistant] patch:", patch);

    switch (patch.op) {
      case "setSlotText":   setSlotText(patch.slot, patch.text); break;
      case "deleteSlot":    setSlotText(patch.slot, "");         break;
      case "replaceText":   replaceText(patch.search, patch.replace); break;
      case "batchUpdate":   if (patch.updates) patch.updates.forEach(handlePatch); break;
      case "batchFill":     if (patch.fills)   applyFillsBatch(patch.fills);       break;
      default: console.warn("[AI Assistant] unknown op:", patch.op);
    }
  }

  // ============================================
  // setSlotText  (tag || alias || title 정규화 매칭)
  // ============================================
  function setSlotText(slotName, text) {
    if (!isPluginReady) return;
    console.log("[setSlotText] slot=" + slotName);

    var body =
      API_GUARD +
      'var slotName = ' + JSON.stringify(slotName) + ';' +
      'var text    = ' + JSON.stringify(text)      + ';' +
      'var target  = slotName.trim().toLowerCase();' +
      'var oDoc = Api.GetDocument();' +
      'var ccs  = oDoc.GetAllContentControls();' +
      'for (var i = 0; i < ccs.length; i++) {' +
        'var cc    = ccs[i];' +
        'var tag   = (cc.GetTag   ? cc.GetTag()   : "") || "";' +
        'var alias = (cc.GetAlias ? cc.GetAlias() : "") || "";' +
        'var title = (cc.GetTitle ? cc.GetTitle() : "") || "";' +
        'var nKey  = (tag || alias || title).trim().toLowerCase();' +
        'if (nKey === target) {' +
          'var p = Api.CreateParagraph();' +
          'p.AddText(text);' +
          'cc.Clear();' +
          'cc.AddElement(p, 0);' +
          'return JSON.stringify({success:true, matched:{tag:tag, alias:alias, title:title}});' +
        '}' +
      '}' +
      'return JSON.stringify({success:false, target:target, reason:"no CC matched"});';

    window.Asc.plugin.callCommand(new Function(body), true, true, function (ret) {
      console.log("[setSlotText] result:", ret);
    });
  }

  // ============================================
  // replaceText  (SearchAndReplace — Api 호출 없음)
  // ============================================
  function replaceText(search, replace) {
    if (!isPluginReady) return;
    window.Asc.plugin.executeMethod("SearchAndReplace", [
      { searchString: search, replaceString: replace, matchCase: false }
    ], function (r) { console.log("[replaceText]", r); });
  }

  // ============================================
  // _fetchCCData — 공유 내부 헬퍼
  //   callCommand body는 여기에만 한 곳에서 정의
  //   diagnoseCCs / debugCCCount 모두 이것을 호출
  // ============================================
  function _fetchCCData(labelTag, onResult) {
    if (!isPluginReady) { console.warn("[" + labelTag + "] not ready"); return; }

    var body =
      API_GUARD +
      'var oDoc  = Api.GetDocument();' +
      'var ccs   = oDoc.GetAllContentControls();' +
      'var items = [];' +
      'for (var i = 0; i < ccs.length; i++) {' +
        'var cc    = ccs[i];' +
        'var tag   = (cc.GetTag   ? cc.GetTag()   : "") || "";' +
        'var alias = (cc.GetAlias ? cc.GetAlias() : "") || "";' +
        'var title = (cc.GetTitle ? cc.GetTitle() : "") || "";' +
        'var id    = (cc.GetId    ? cc.GetId()    : i);' +
        'var rng   = cc.GetRange  ? cc.GetRange()  : null;' +
        'var txt   = (rng && rng.GetText) ? rng.GetText() : "";' +
        'items.push({index:i, id:id, tag:tag, alias:alias, title:title, textPreview:txt.substring(0,50)});' +
      '}' +
      'return JSON.stringify({count:ccs.length, items:items});';

    window.Asc.plugin.callCommand(new Function(body), true, true, function (ret) {
      try {
        var parsed = JSON.parse(ret);
        onResult(parsed);
      } catch (e) {
        console.error("[" + labelTag + "] JSON 파싱 실패:", e, "raw:", ret);
      }
    });
  }

  // ============================================
  // diagnoseCCs  ←── 자동 실행 (init 3초 후)
  // ============================================
  function diagnoseCCs() {
    console.log("[diagnoseCCs] 실행...");

    _fetchCCData("diagnoseCCs", function (result) {
      if (result.error) { console.error("[diagnoseCCs] ERROR:", result.error); return; }

      console.log("\n========================================");
      console.log("[CC 진단] count = " + result.count);
      console.log("----------------------------------------");

      result.items.forEach(function (cc) {
        console.log(
          "[" + cc.index + "] id="    + cc.id +
          " tag="   + JSON.stringify(cc.tag) +
          " alias=" + JSON.stringify(cc.alias) +
          " title=" + JSON.stringify(cc.title) +
          " text="  + JSON.stringify(cc.textPreview)
        );
      });

      var taggedCount = result.items.filter(function (c) { return c.tag; }).length;
      console.log("----------------------------------------");
      console.log("전체 CC 수 : " + result.count + "  |  tag 있는 CC : " + taggedCount);
      console.log("========================================\n");
    });
  }

  // debugCCCount は IIFE 밖에서 자기포함형으로 등록済み (위 참조)

  // ============================================
  // applyFillsBatch
  //   매칭 키: (tag || alias || title).trim().toLowerCase()
  //   misses에 정규화 후 비교값까지 출력
  // ============================================
  function applyFillsBatch(fills) {
    if (!isPluginReady) return;
    console.log("[Batch Fill] " + fills.length + " items");

    // fills를 body에 리터럴로 주입
    var fillsLiteral = JSON.stringify(fills);

    var body =
      API_GUARD +
      'var oDoc  = Api.GetDocument();' +
      'var ccs   = oDoc.GetAllContentControls();' +
      // CC 목록에서 정규화 키 → CC 맵 구성 (진단용 키 목록도 유지)
      'var ccMap  = {};' +      // normalizedKey → cc
      'var ccKeys = [];' +      // 진단용: 전체 정규화 키 목록
      'for (var i = 0; i < ccs.length; i++) {' +
        'var cc    = ccs[i];' +
        'var tag   = (cc.GetTag   ? cc.GetTag()   : "") || "";' +
        'var alias = (cc.GetAlias ? cc.GetAlias() : "") || "";' +
        'var title = (cc.GetTitle ? cc.GetTitle() : "") || "";' +
        'var nKey  = (tag || alias || title).trim().toLowerCase();' +
        'if (nKey) { ccMap[nKey] = cc; ccKeys.push(nKey); }' +
      '}' +

      // 주입된 fills 리스트
      'var fills = ' + fillsLiteral + ';' +

      'var results = {' +
        'totalCCs:ccs.length,' +
        'ccKeys:ccKeys,' +
        'requested:fills.length,' +
        'ok:0, fail:0, misses:[]' +
      '};' +

      'for (var j = 0; j < fills.length; j++) {' +
        'var fill = fills[j];' +
        'var slotId = fill.slot_id || "";' +
        'var normalizedSlot = slotId.trim().toLowerCase();' +
        'var value  = fill.value || "";' +
        'var cc = ccMap[normalizedSlot];' +

        'if (!cc) {' +
          'results.misses.push({' +
            'slot_id:slotId,' +
            'normalized:normalizedSlot,' +
            'reason:"no CC. available keys: [" + ccKeys.join(", ") + "]"' +
          '});' +
          'continue;' +
        '}' +

        'try {' +
          'cc.Clear();' +
          'var lines = value.split("\\n");' +
          'for (var k = 0; k < lines.length; k++) {' +
            'var p = Api.CreateParagraph();' +
            'p.AddText(lines[k]);' +
            'cc.AddElement(p, k);' +
          '}' +
          'results.ok++;' +
        '} catch (e) {' +
          'results.fail++;' +
          'results.misses.push({slot_id:slotId, normalized:normalizedSlot, reason:"error: "+e.message});' +
        '}' +
      '}' +

      'return JSON.stringify(results);';

    window.Asc.plugin.callCommand(new Function(body), true, true, function (ret) {
      try {
        var result = JSON.parse(ret);

        if (result.error) { console.error("[Batch Fill] ERROR:", result.error); return; }

        console.log("\n========================================");
        console.log("[Batch Fill 결과]");
        console.log("----------------------------------------");
        console.log("문서 총 CC 수        : " + result.totalCCs);
        console.log("매칭 가능한 정규화 키 : " + JSON.stringify(result.ccKeys));
        console.log("요청 수              : " + result.requested);
        console.log("성공 (ok)            : " + result.ok);
        console.log("실패 (fail)          : " + result.fail);

        if (result.misses.length > 0) {
          console.log("--- Misses 상세 (" + result.misses.length + "개) ---");
          result.misses.forEach(function (m) {
            console.log("  slot_id="    + JSON.stringify(m.slot_id) +
                        " normalized=" + JSON.stringify(m.normalized) +
                        " → " + m.reason);
          });
        }

        if (result.ok === result.requested) {
          console.log("✅ 모든 채우기 성공!");
        } else {
          console.warn("⚠️ ok=" + result.ok + " / requested=" + result.requested);
        }
        console.log("========================================\n");

      } catch (e) {
        console.error("[Batch Fill] 파싱 실패:", e, "raw:", ret);
      }
    });
  }

  // ============================================
  // User Edit Tracking
  // ============================================
  window.Asc.plugin.event_onChangeContentControl = function (data) {
    console.log("[AI Assistant] CC changed:", data);
    if (documentKey) {
      fetch(NEXT_URL + "/api/realtime/user-edit", {
        method:  "POST",
        headers: {"Content-Type": "application/json"},
        body:    JSON.stringify({documentKey: documentKey, slot: data.Tag, newValue: data.InternalId})
      }).catch(function (e) { console.error("[user-edit]", e); });
    }
  };

  window.Asc.plugin.button = function () {
    console.log("[AI Assistant][BUTTON] called — background plugin이므로 close 실행하지 않음", new Error().stack);
  };

  console.log("[AI Assistant][IIFE_DONE]", __BUILD_ID__, {
    debugCCCount:            typeof globalThis.debugCCCount,
    verifyContentControls:   typeof globalThis.verifyContentControls,
    diagnoseCCs:             typeof globalThis.diagnoseCCs,
    applyFillsBatch:         typeof globalThis.applyFillsBatch,
    toggleSSE:               typeof globalThis.toggleSSE
  });
})(window, undefined);
