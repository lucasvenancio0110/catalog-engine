import Swiper from 'swiper';
import { A11y, Keyboard, Navigation, Pagination } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/navigation';
import 'swiper/css/pagination';

export function mountProductGallery(container, images = [], productName = 'Produto', onChange = () => {}) {
  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'swiper-wrapper';

  images.forEach((src, index) => {
    const slide = document.createElement('div');
    slide.className = 'swiper-slide';

    const image = document.createElement('img');
    image.src = src;
    image.alt = `${productName} — foto ${index + 1}`;
    image.loading = index === 0 ? 'eager' : 'lazy';

    slide.appendChild(image);
    wrapper.appendChild(slide);
  });

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'swiper-button-prev';
  prev.setAttribute('aria-label', 'Foto anterior');

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'swiper-button-next';
  next.setAttribute('aria-label', 'Próxima foto');

  const pagination = document.createElement('div');
  pagination.className = 'swiper-pagination';

  container.append(wrapper, prev, next, pagination);

  const swiper = new Swiper(container, {
    modules: [Navigation, Pagination, Keyboard, A11y],
    slidesPerView: 1,
    spaceBetween: 8,
    speed: 300,
    keyboard: { enabled: true },
    navigation: { prevEl: prev, nextEl: next },
    pagination: { el: pagination, clickable: true },
    on: {
      init(instance) {
        onChange(instance.activeIndex);
      },
      slideChange(instance) {
        onChange(instance.activeIndex);
      }
    }
  });

  return {
    slideTo(index) {
      swiper.slideTo(index);
    },
    destroy() {
      swiper.destroy(true, true);
      container.innerHTML = '';
    }
  };
}
