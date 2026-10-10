/**
 * Minimal sandbox example with no framework or build step.
 * The host supplies window.mnx for props, rendering and completion.
 */
(function () {
  var host = window.mnx;
  var startedAt = Date.now();

  var QUESTIONS = [
    { prompt: 'A sandboxed add-on can read the page that launched it.', answer: false },
    { prompt: 'The host decides what an add-on is allowed to do.', answer: true },
    { prompt: 'An add-on can grant itself permissions it did not declare.', answer: false },
  ];

  var index = 0;
  var correct = 0;

  // The host supplies primitive styles and theme tokens; this file adds layout.
  var layout = document.createElement('style');
  layout.textContent = [
    '.wrap { max-width: 34rem; margin: 0 auto; padding: 2rem 1.5rem; }',
    '.actions { display: flex; gap: 0.5rem; margin-top: 1.5rem; }'
  ].join('\n');
  document.head.appendChild(layout);

  function render() {
    if (index >= QUESTIONS.length) return finish();

    var question = QUESTIONS[index];
    host.root.innerHTML =
      '<div class="wrap">' +
      '<div class="primitive-content-card">' +
      '<div class="primitive-content-card__header">' +
      // Plain text, not primitive-badge: the badge's accent-on-tint text is
      // below the readable minimum (4.5:1) in the default light theme.
      '<span>Question ' + (index + 1) + ' of ' + QUESTIONS.length + '</span>' +
      '</div>' +
      '<div class="primitive-content-card__body"><p class="q"></p></div>' +
      '</div>' +
      '<div class="actions">' +
      '<button class="primitive-button primitive-button--primary primitive-button--md" data-answer="true">True</button>' +
      '<button class="primitive-button primitive-button--secondary primitive-button--md" data-answer="false">False</button>' +
      '</div>' +
      '</div>';

    // Use textContent for question text.
    host.root.querySelector('.q').textContent = question.prompt;

    Array.prototype.forEach.call(host.root.querySelectorAll('button'), function (button) {
      button.addEventListener('click', function () {
        if ((button.getAttribute('data-answer') === 'true') === question.answer) correct++;
        index++;
        render();
      });
    });
  }

  function finish() {
    host.root.innerHTML =
      '<div class="wrap"><div class="primitive-content-card">' +
      '<div class="primitive-content-card__body"><p class="done"></p></div>' +
      '</div></div>';
    host.root.querySelector('.done').textContent =
      'Finished: ' + correct + ' of ' + QUESTIONS.length + ' correct.';

    host.complete({
      completed: true,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      // Recall requires a quality grade from 0 to 5.
      quality: Math.round((correct / QUESTIONS.length) * 5),
      completedStages: ['reference-quiz']
    });
  }

  render();
}());
