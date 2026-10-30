// CloudFront Function (viewer request) on the default (S3) behavior.
// Paths without a file extension, such as /tasks/42, are client-side routes: serve
// /index.html so React Router can render them. Real files (/assets/app.js) pass through.
// API paths never reach this function - they match the /api/* behavior first.
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);

  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
