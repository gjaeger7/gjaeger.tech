const slides = [...document.querySelectorAll('.slide')];

function currentSlideIndex() {
  const midpoint = window.scrollY + window.innerHeight / 2;
  return Math.max(0, slides.findIndex((slide) => {
    const top = slide.offsetTop;
    const bottom = top + slide.offsetHeight;
    return midpoint >= top && midpoint < bottom;
  }));
}

function goToSlide(index) {
  const next = slides[Math.max(0, Math.min(slides.length - 1, index))];
  next.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, button')) return;
  const index = currentSlideIndex();
  if (['ArrowDown', 'PageDown', ' '].includes(event.key)) {
    event.preventDefault();
    goToSlide(index + 1);
  }
  if (['ArrowUp', 'PageUp'].includes(event.key)) {
    event.preventDefault();
    goToSlide(index - 1);
  }
  if (event.key === 'Home') {
    event.preventDefault();
    goToSlide(0);
  }
  if (event.key === 'End') {
    event.preventDefault();
    goToSlide(slides.length - 1);
  }
});
