const tabs = document.querySelectorAll('.tab');
const contents = document.querySelectorAll('.example-content');

const frame = document.getElementById('exampleFrame');
const previewLink = document.getElementById('previewLink');
const previewLabel = document.getElementById('previewLabel');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    contents.forEach((c) => c.classList.remove('active'));
    tab.classList.add('active');

    const activeContent = document.getElementById(tab.dataset.target);
    activeContent.classList.add('active');

    const url = activeContent.dataset.url;
    if (frame && url) frame.src = url;
    if (previewLink && url) previewLink.href = url;
    if (previewLabel) previewLabel.textContent = `${tab.textContent} preview`;
  });
});

const accordions = document.querySelectorAll('.accordion');
accordions.forEach((button) => {
  button.addEventListener('click', () => {
    const panel = button.nextElementSibling;
    button.classList.toggle('open');
    panel.classList.toggle('open');
  });
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.12 });

document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

document.querySelector('.theme-toggle').addEventListener('click', () => {
  document.body.classList.toggle('glow');
});
