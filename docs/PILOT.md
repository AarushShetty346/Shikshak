# Running a small pilot

The app's **Pilot tools** (footer link, `#/pilot`) are for one facilitator on one device. They
cover a small, honest trial: a handful of class 10 students, one chapter (arithmetic progressions),
about a week. No pilot has been run yet. Nothing in this repo reports learning gains, and nothing
should until a pilot has actually happened.

## What the tool records

- **Participants** are codes like `P01`. **Never names.** The tool refuses to add anyone without
  both a guardian's consent and the student's own agreement. It also records whether audio
  recording is allowed.
- **Quiz forms A and B** cover the same skills at the same difficulty, with different numbers. A
  student takes one before and the other after (alternate the order between students). **Form C**
  is a delayed check about a week later. Every answer was checked by the maths engine. Students get
  no feedback during a form, and each item can be answered once.
- **Issues** are notes during a session ("checker misread line 3", "voice cut out").
- **Feedback** is a short questionnaire at the end.
- **Export** is an anonymised CSV: codes, form scores, timings, issue counts. It has no names, no
  phone numbers and no audio.

## How to read the results

With a few students and no control group, a pilot can show that students **used** it, where it
**broke**, and what they **said**. It can't show that Shikshak **caused** better scores: practice
on form A alone, or just a week of revision, could explain a rise on form B. The export carries
this caveat, so keep it next to any number you share.

## Consent templates

Print two copies of each: one for the family, one for you. Keep the signed forms on paper. Don't
photograph them into the app.

### Parent or guardian consent (English)

> **Shikshak maths tutor: small trial**
>
> We are students building Shikshak, a maths tutor that talks with your child and checks their
> written working on a screen. We would like your child to try it for about a week, for class 10
> arithmetic progressions.
>
> - Your child will use Shikshak for about 20 to 30 minutes a day and answer two short quizzes
>   before and after, and one a week later.
> - We record your child's answers and quiz scores under a code (like P01), not their name.
> - Voice classes go through a voice service (Bolna) and handwriting is read by an AI model
>   (Google Gemini). We don't keep audio recordings unless you tick the box below.
> - Taking part is voluntary. You or your child can stop at any time, and we will delete their
>   records if you ask.
> - This is a trial of a student project, not a school assessment. Practice marks shown in the app
>   are not official CBSE marks.
>
> Contact: ______________________ (name, phone)
>
> - [ ] I agree to my child taking part.
> - [ ] I agree to audio recordings being kept for this trial (optional).
>
> Child's code: ______  Guardian's name: ______________________  Signature: __________  Date: ______

### अभिभावक की सहमति (हिन्दी)

Have a fluent reader check this before use.

> **शिक्षक मैथ्स ट्यूटर: छोटा ट्रायल**
>
> हम छात्र हैं और "शिक्षक" बना रहे हैं, एक मैथ्स ट्यूटर जो आपके बच्चे से बात करता है और स्क्रीन पर लिखा हुआ हल जाँचता है।
> हम चाहते हैं कि आपका बच्चा लगभग एक हफ़्ते तक कक्षा 10 के समांतर श्रेढ़ी (AP) अध्याय के लिए इसे इस्तेमाल करे।
>
> - रोज़ लगभग 20–30 मिनट, और पहले-बाद में दो छोटे क्विज़ और एक हफ़्ते बाद एक क्विज़।
> - जवाब और अंक एक कोड (जैसे P01) के साथ रखे जाते हैं, नाम के साथ नहीं।
> - आवाज़ वाली कक्षा एक वॉइस सेवा (Bolna) से चलती है और लिखावट एक AI मॉडल (Google Gemini) पढ़ता है। नीचे का बॉक्स टिक न करें तो हम ऑडियो नहीं रखते।
> - भाग लेना आपकी मर्ज़ी है। आप या आपका बच्चा कभी भी रुक सकते हैं, और कहने पर हम रिकॉर्ड मिटा देंगे।
> - यह एक छात्र प्रोजेक्ट का ट्रायल है, स्कूल की परीक्षा नहीं। ऐप में दिखने वाले प्रैक्टिस अंक CBSE के आधिकारिक अंक नहीं हैं।
>
> संपर्क: ______________________
>
> - [ ] मैं सहमत हूँ कि मेरा बच्चा भाग ले।
> - [ ] मैं ऑडियो रिकॉर्डिंग रखने के लिए सहमत हूँ (वैकल्पिक)।
>
> बच्चे का कोड: ______ अभिभावक का नाम: ______________ हस्ताक्षर: ________ तारीख़: ______

### Student agreement (read it aloud with the student)

> I'm going to try a maths tutor on a screen for about a week. It will talk with me and look at my
> working. My answers are kept under a code, not my name. This isn't a test for school. I can stop
> any time, and that's fine.
>
> - [ ] I'd like to try it.
>
> Code: ______  Date: ______

## Facilitator checklist

- [ ] Both forms are signed before the first session. Add the participant in Pilot tools with both
      boxes ticked.
- [ ] Alternate form order: odd codes take A first, even codes take B first.
- [ ] Log every problem as an issue, even small ones.
- [ ] Give form C 6 to 8 days after the last session.
- [ ] Export the CSV, then delete the participants in Pilot tools. Keep the paper forms as the
      school or guardian asks.
- [ ] To delete a participant's records on request: Pilot tools, then the participant, then Delete.
