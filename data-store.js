(function () {
  const STORAGE_KEY = "devtrend_inblog_data_v1";
  const CHANNEL_NAME = "devtrend_inblog_channel";
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL_NAME) : null;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createSection(title) {
    return {
      id: uid("sec"),
      subtitle: `${title} 핵심 내용`,
      body: `${title}에 대한 운영 원칙과 실무 적용 기준을 작성하세요.`
    };
  }

  function createContent(groupTitle, itemTitle) {
    return {
      title: itemTitle,
      lead: `${groupTitle} 카테고리 문서입니다. 실무에서 바로 참고할 핵심 내용을 정리하세요.`,
      sections: [
        {
          id: uid("sec"),
          subtitle: `${itemTitle} 소개`,
          body: `${itemTitle}의 목적과 적용 대상을 작성하세요.`
        },
        {
          id: uid("sec"),
          subtitle: "진행 기준",
          body: "진행 전 확인할 기준, 역할, 의사결정 경로를 작성하세요."
        },
        {
          id: uid("sec"),
          subtitle: "실행 방법",
          body: "실무자가 바로 수행할 수 있도록 단계별 실행 방법을 작성하세요."
        }
      ]
    };
  }

  function createDefaultData() {
    const raw = [
      {
        group: "Devtrend 활용TIP",
        items: ["첫 미팅 가이드", "프로덕트 초기 가이드", "커뮤니케이션 가이드"]
      },
      {
        group: "프로젝트 조정",
        items: [
          "연장/종료/홀딩",
          "투입시간 조정(상향/하향)",
          "장기 협업(장기계약)",
          "크리에이터 교체/추가매칭"
        ]
      },
      {
        group: "계약/결제",
        items: ["계약", "결제", "성과급", "환불"]
      },
      {
        group: "devtrend 프로세스",
        items: ["사전미팅", "마케팅 컨설팅", "크리에이터 매칭", "풀스텍 영상 제작", "피드백", "게시 및 데이터 분석"]
      },
      {
        group: "크리에이터 매칭 방식",
        items: ["큐레이션"]
      },
      {
        group: "추가 유형",
        items: ["CS", "CPA", "프로젝트/작업제"]
      },
      {
        group: "FAQ",
        items: ["자주 묻는 질문", "devtrend , 왜 좋을까요?", "세금계산서 FAQ"]
      },
      {
        group: "프로모션",
        items: ["Devtrend Risk-Free 프로그램", "고객 Best Practice(BP) 콘텐츠 안내"]
      }
    ];

    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      groups: raw.map((group) => ({
        id: uid("grp"),
        title: group.group,
        items: group.items.map((itemTitle) => ({
          id: uid("itm"),
          title: itemTitle,
          content: createContent(group.group, itemTitle)
        }))
      }))
    };
  }

  function getData() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      const defaults = createDefaultData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }

    try {
      const parsed = JSON.parse(stored);
      if (!parsed || !Array.isArray(parsed.groups)) {
        throw new Error("Invalid data format");
      }
      return parsed;
    } catch (_) {
      const defaults = createDefaultData();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      return defaults;
    }
  }

  function saveData(nextData) {
    const payload = {
      ...nextData,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    if (channel) {
      channel.postMessage({ type: "updated", at: payload.updatedAt });
    }
    return payload;
  }

  function subscribeData(callback) {
    function onStorage(event) {
      if (event.key === STORAGE_KEY) {
        callback(getData());
      }
    }

    function onChannelMessage(event) {
      if (event && event.data && event.data.type === "updated") {
        callback(getData());
      }
    }

    window.addEventListener("storage", onStorage);
    if (channel) {
      channel.addEventListener("message", onChannelMessage);
    }

    return function unsubscribe() {
      window.removeEventListener("storage", onStorage);
      if (channel) {
        channel.removeEventListener("message", onChannelMessage);
      }
    };
  }

  window.InblogStore = {
    STORAGE_KEY,
    uid,
    clone,
    getData,
    saveData,
    subscribeData,
    createContent,
    createSection
  };
})();
