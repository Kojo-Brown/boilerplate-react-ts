import type { MessageId } from "@/shared/i18n/messages/en-GB";

/**
 * The Arabic catalogue.
 *
 * Typed as `Record<MessageId, string>` rather than inferred, and that is the
 * only reason this file can be trusted: an id added to `en-GB.ts` and not
 * translated here fails `tsc`, and so does a key left behind by a rename.
 * Neither failure has a runtime symptom worth waiting for — react-intl falls
 * back to the default locale's string and logs, so a missing translation looks
 * like a page that is *mostly* translated, which is the bug that ships.
 *
 * Three things in here are not word-for-word renderings of the English, and
 * each is the kind of decision a `Record<id, string>` exists to make room for:
 *
 * - **`route.announcement` uses the Arabic comma** (`،`, U+060C). It is a
 *   different character from `,`, not a styling of it.
 * - **The plural messages have a different set of branches.** English declares
 *   `=0` for its "No notifications" case; Arabic declares `zero`, because
 *   Arabic genuinely has a zero plural category and CLDR applies it to exactly
 *   n=0 — an `=0` branch on top of it would be dead syntax.
 * - **`selectordinal` collapses to `other`.** Arabic has one ordinal form; a
 *   `one`/`two`/`few` split copied from English would be branches CLDR never
 *   selects.
 */
export const AR_EG_MESSAGES: Record<MessageId, string> = {
  // ── Application shell ───────────────────────────────────────────────────
  "nav.main": "التنقل الرئيسي",
  "nav.drawer": "التنقل",
  "nav.sidebar": "التنقل الجانبي",
  "nav.toggleSidebar": "تبديل الشريط الجانبي",
  "nav.home": "الرئيسية",
  "nav.dashboard": "لوحة التحكم",
  "nav.about": "حول",
  "skipLink.mainContent": "تجاوز إلى المحتوى الرئيسي",

  "document.title": "{page} · {app}",
  "document.titleFallback": "{app}",
  "route.announcement": "{page}، تم تحميل الصفحة",

  // ── Language switcher ───────────────────────────────────────────────────
  "locale.label": "اللغة",
  "locale.pending": "جارٍ تغيير اللغة…",
  "locale.changed": "تم تغيير اللغة إلى {language}",

  // ── Route titles ────────────────────────────────────────────────────────
  "route.home.title": "الرئيسية",
  "route.dashboard.title": "لوحة التحكم",
  "route.about.title": "حول",
  "route.login.title": "تسجيل الدخول",
  "route.oauthCallback.title": "جارٍ تسجيل الدخول",
  "route.notFound.title": "الصفحة غير موجودة",
  "route.concurrencyLab.title": "مختبر التزامن",
  "route.optimisticLab.title": "مختبر التحديث المتفائل",
  "route.queryCacheLab.title": "مختبر ذاكرة الاستعلامات",
  "route.useApiLab.title": "مختبر use()‎",
  "route.actionsLab.title": "مختبر الإجراءات",
  "route.streamingLab.title": "مختبر التدفق مع Suspense",
  "route.navigationLab.title": "مختبر انتقالات المسارات",
  "route.slowRoute.title": "مسار بطيء",
  "route.headlessLab.title": "مختبر المكونات بلا واجهة",
  "route.keyboardLab.title": "مختبر لوحة المفاتيح",
  "route.liveRegionsLab.title": "مختبر المناطق الحيوية",
  "route.polymorphicLab.title": "مختبر المكونات متعددة الأشكال",
  "route.renderPropsLab.title": "مختبر خصائص العرض",
  "route.checkoutLab.title": "مختبر إتمام الشراء",
  "route.dependencyInversionLab.title": "مختبر عكس التبعيات",
  "route.workerLab.title": "مختبر عمال الويب",
  "route.infiniteScrollLab.title": "مختبر التمرير اللانهائي بنافذة",
  "route.prefetchLab.title": "مختبر التحميل المسبق",
  "route.imageLab.title": "مختبر الصور",
  "route.errorLab.title": "مختبر الأخطاء",
  "route.i18nLab.title": "مختبر التدويل",

  // ── Internationalisation lab ────────────────────────────────────────────
  "i18nLab.heading": "التدويل",
  "i18nLab.intro":
    "كل نص هنا يأتي من كتالوج، وكل رقم وتاريخ من مُنسِّق. بدّل اللغة من الشريط العلوي لترى المكونات نفسها في {localeCount, plural, zero {# لغة} one {لغة واحدة} two {لغتين} few {# لغات} many {# لغة} other {# لغة}}.",

  "i18nLab.plurals.heading": "صيغ الجمع",
  "i18nLab.plurals.explainer":
    "للإنجليزية صيغتان للجمع وللعربية ست صيغ. العدد أدناه هو نفسه في اللغتين؛ الجملة ليست كذلك.",
  "i18nLab.plurals.count": "الإشعارات",
  "i18nLab.plurals.notifications":
    "{count, plural, zero {لا إشعارات} one {إشعار واحد} two {إشعاران} few {# إشعارات} many {# إشعارًا} other {# إشعار}}",
  "i18nLab.plurals.ordinal": "الترتيب {position, selectordinal, other {#}} في قائمة الانتظار",

  "i18nLab.numbers.heading": "الأرقام",
  "i18nLab.numbers.explainer":
    "قيمة واحدة وأربعة مُنسِّقات. فاصل الآلاف والفاصلة العشرية والأرقام نفسها كلها من اختيار اللغة.",
  "i18nLab.numbers.decimal": "عشري",
  "i18nLab.numbers.percent": "نسبة مئوية",
  "i18nLab.numbers.currency": "عملة",
  "i18nLab.numbers.unit": "وحدة",
  "i18nLab.numbers.currencyNote": "المبلغ هو {amount} في كلتا اللغتين — اللغة ليست عملة.",

  "i18nLab.dates.heading": "التواريخ والأوقات",
  "i18nLab.dates.explainer":
    "صيغ مُسمّاة، معرَّفة مرة واحدة في formats.ts، ليظهر التاريخ بالشكل نفسه في كل مكان.",
  "i18nLab.dates.short": "قصير",
  "i18nLab.dates.long": "طويل",
  "i18nLab.dates.time": "الوقت",
  "i18nLab.dates.relative": "نسبي",
  "i18nLab.dates.calendarNote":
    "تستخدم العربية هنا التقويم الميلادي بالأرقام العربية الهندية، وهو ما يحدده ar-EG.",

  "i18nLab.lists.heading": "القوائم",
  "i18nLab.lists.explainer":
    "الربط بفاصلة وبكلمة «و» قاعدة نحوية لا علامة ترقيم، و Intl.ListFormat هو ما يتولاها.",

  "i18nLab.direction.heading": "الاتجاه",
  "i18nLab.direction.explainer":
    "المستند {direction, select, rtl {من اليمين إلى اليسار} other {من اليسار إلى اليمين}}. لا شيء أدناه يحدد جهة: التنسيق يستخدم الخصائص المنطقية، فينعكس دون ورقة أنماط ثانية.",
  "i18nLab.direction.current": "الاتجاه الحالي",
  "i18nLab.direction.bidiHeading": "النص ثنائي الاتجاه",
  "i18nLab.direction.bidiSample": "الإصدار موسوم بـ {tag} ويُنشر من {branch}.",
};
