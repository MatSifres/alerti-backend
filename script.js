(function() {
  if (window.location.hostname === 'lumea-ar.com' || window.location.hostname.endsWith('.lumea-ar.com')) {
    console.log('Script deshabilitado para lumea-ar.com');
    return;
  }

  window.addEventListener('load', function() {
    var pageLoadTimestamp = sessionStorage.getItem('pageLoadTimestamp');
    var currentTime = new Date().getTime();

    if (!pageLoadTimestamp || (currentTime - pageLoadTimestamp > 5000)) {
      sessionStorage.setItem('pageLoadTimestamp', currentTime);

      if (typeof LS !== 'undefined' && LS.cart && LS.cart.id) {
        var cartId = LS.cart.id;
        var storeId = LS.store ? LS.store.id : null;
        var fullCartUrl = window.location.origin + (LS.cart.pathname || window.location.pathname);

        if (cartId && storeId && !window.location.href.includes('success')) {
          var requestId = cartId + '-' + window.location.pathname;
          var sentRequests = JSON.parse(sessionStorage.getItem('sentRequests') || '{}');

          if (!sentRequests[requestId]) {
            fetch('https://alerti-backend.vercel.app/api/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                order_id: cartId,
                store_id: storeId,
                cart_url: fullCartUrl
              })
            })
            .then(r => r.json().catch(() => ({})))
            .then(data => {
              console.log('Checkout enviado a backend:', data);
              sentRequests[requestId] = currentTime;
              sessionStorage.setItem('sentRequests', JSON.stringify(sentRequests));
            })
            .catch(err => console.error('Error enviando checkout:', err));
          }
        }
      } else {
        console.error('No se encontró LS.cart o el cartId');
      }
    }
  });
})();
