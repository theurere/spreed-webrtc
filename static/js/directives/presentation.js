/*
 * Spreed WebRTC.
 * Copyright (C) 2013-2014 struktur AG
 *
 * This file is part of Spreed WebRTC.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

"use strict";
define(['jquery', 'underscore', 'text!partials/presentation.html'], function($, _, template) {

	return ["$window", "mediaStream", "alertify", "translation", function($window, mediaStream, alertify, translation) {

		var controller = ['$scope', '$element', '$attrs', function($scope, $element, $attrs) {

			//temp vars
			var doc = {};
			var DownloadPresentation;
			var SUPPORTED_TYPES;
			var availablePresentations;
			//end temp vars

			var presentationsCount = 0;

			$scope.layout.presentation = true;
			$scope.hideControlsBar = true;
			$scope.currentPageNumber = -1;
			$scope.maxPageNumber = -1;
			$scope.pendingPageRequest = null;
			$scope.presentationLoaded = false;
			$scope.currentPresentation = null;
			$scope.currentPage = null;
			$scope.receivedPage = null;
			$scope.loading = false;
			$scope.activeDownloads = [];
			$scope.availablePresentations = [];

			$scope.getPresentation = function(token) {
				// TODO(fancycode): better not use linear search,
				// however we need a list for "ng-repeat" to allow
				// sorting.
				var result = _.find($scope.availablePresentations, function(presentation) {
					return (presentation.token === token);
				});
				return result || null;
			};

			$scope.resetProperties = function() {
				$scope.currentPageNumber = -1;
				$scope.maxPageNumber = -1;
				$scope.pendingPageRequest = null;
				$scope.presentationLoaded = false;
				$scope.currentPresentation = null;
				$scope.currentPage = null;
				$scope.receivedPage = null;
				$scope.loading = false;
			};

			var presentationLoaded = function(numPages) {
				$scope.maxPageNumber = doc.numPages;
				if ($scope.currentPresentation && $scope.currentPresentation.presentable) {
					$scope.currentPageNumber = 1;
				} else if ($scope.pendingPageRequest !== null) {
					$scope.currentPageNumber = $scope.pendingPageRequest;
					$scope.pendingPageRequest = null;
				}
				$scope.presentationLoaded = true;
			};

			var presentationLoadError = function(errorMessage) {
				$scope.loading = false;
				alertify.dialog.alert(errorMessage);
			};

			var downloadPresentation = function(fileInfo, from) {
				var token = fileInfo.id;
				var existing = $scope.getPresentation(token);
				if (existing) {
					console.log("Found existing presentation", existing);
					return;
				}

				var download = _.find($scope.activeDownloads, function(download) {
					return (download.token === token);
				});
				if (download) {
					// already downloading presentation, wait for completion
					console.log("Still downloading presentation", download);
					return;
				}

				download = new DownloadPresentation($scope, fileInfo, token, from);
				download.e.one("available", function(event, download, url, fileInfo) {
					var pos = _.indexOf($scope.activeDownloads, download);
					if (pos !== -1) {
						$scope.activeDownloads.splice(pos, 1);
					}
				});
				$scope.activeDownloads.push(download);
				$scope.availablePresentations.push(download);
				download.start();
			};

			var uploadPresentation = function(file) {
				var token = file.info.id;
				var existing = $scope.getPresentation(token);
				if (existing) {
					console.log("Already uploaded presentation", existing);
					return existing;
				}
				$scope.availablePresentations.push(file);
			};

			mediaStream.api.e.on("received.presentation", function(event, id, from, data, p2p) {
				if (!p2p) {
					console.warn("Received presentation info without p2p. This should not happen!");
					return;
				}

				if (data.Type) {
					switch (data.Type) {
					case "FileInfo":
						console.log("Received presentation file request", data);
						$scope.$apply(function(scope) {
							//downloadPresentation(data.FileInfo, from);
						});
						break;

					case "Delete":
						console.log("Received presentation delete request", data);
						$scope.$apply(function(scope) {
							var token = data.Delete;
							var existing = _.find(scope.availablePresentations, function(presentation) {
								// only allow deleting of presentations we downloaded
								return (!presentation.uploaded && presentation.token === token);
							});
							if (existing) {
								//scope.deletePresentation(existing);
							}
						});
						break;

					case "Show":
						console.log("Received presentation show request", data);
						$scope.$apply(function(scope) {
							if (!scope.layout.presentation) {
								scope.resetProperties();
								scope.layout.presentation = true;
							}
						});
						break;

					case "Hide":
						console.log("Received presentation hide request", data);
						$scope.$apply(function(scope) {
							scope.layout.presentation = false;
						});
						break;

					case "Select":
						console.log("Received presentation select request", data);
						$scope.$apply(function(scope) {
							var token = data.Select;
							var existing = _.find(scope.availablePresentations, function(presentation) {
								// only allow deleting of presentations we downloaded
								return (!presentation.uploaded && presentation.token === token);
							});
							if (existing) {
								scope.doSelectPresentation(existing);
							} else {
								console.log("No presentation found for token", token);
							}
						});
						break;

					case "Page":
						$scope.$apply(function(scope) {
							scope.receivedPage = data.Page;
							if (!scope.presentationLoaded) {
								console.log("Queuing presentation page request, not loaded yet", data);
								scope.pendingPageRequest = data.Page;
							} else {
								console.log("Received presentation page request", data);
								scope.currentPageNumber = data.Page;
							}
						});
						break;

					default:
						console.log("Received unknown presentation event", data);
					}
				}
			});

			var peers = {};
			var presentations = [];
			var currentToken = null;
			var tokenHandler = null;

			var mediaStreamSendPresentation = function(peercall, token, params) {
				mediaStream.api.apply("sendPresentation", {
					send: function(type, data) {
						if (!peercall.peerconnection.datachannelReady) {
							return peercall.e.one("dataReady", function() {
								peercall.peerconnection.send(data);
							});
						} else {
							return peercall.peerconnection.send(data);
						}
					}
				})(peercall.id, token, params);
			};

			var connector = function(token, peercall) {
				//console.log("XXX connector", token, peercall, peers);
				if (peers.hasOwnProperty(peercall.id)) {
					// Already got a connection.
					return;
				}
				peers[peercall.id] = true;
				mediaStreamSendPresentation(peercall, token, {
					Type: "Show",
					Show: true
				});
				_.each($scope.availablePresentations, function(presentation) {
					if (presentation.uploaded) {
						mediaStreamSendPresentation(peercall, token, {
							Type: "FileInfo",
							FileInfo: presentation.info
						});
					}
				});
				if ($scope.currentPresentation && $scope.currentPresentation.uploaded) {
					mediaStreamSendPresentation(peercall, token, {
						Type: "Select",
						Select: $scope.currentPresentation.token
					});

					if ($scope.currentPage !== null) {
						mediaStreamSendPresentation(peercall, token, {
							Type: "Page",
							Page: $scope.currentPage
						});
					}
				}
			};

			// Updater function to bring in new calls.
			var updater = function(event, state, currentcall) {
				switch (state) {
					case "completed":
					case "connected":
						connector(currentToken, currentcall);
						break;
					case "closed":
						delete peers[currentcall.id];
						if (_.isEmpty(peers)) {
							console.log("All peers disconnected, stopping presentation");
							$scope.$apply(function(scope) {
								scope.hidePresentation();
							});
						}
						break;
				}
			};

			$scope.$on("presentationPageLoading", function(event, page) {
				$scope.loading = false;
				$scope.currentPageNumber = page;
				if ($scope.receivedPage === page) {
					// we received this page request, don't publish to others
					$scope.receivedPage = null;
					return;
				}

				$scope.currentPage = page;
				mediaStream.webrtc.callForEachCall(function(peercall) {
					mediaStreamSendPresentation(peercall, currentToken, {
						Type: "Page",
						Page: page
					});
				});
			});

			$scope.$on("presentationPageLoadError", function(event, page, errorMessage) {
				$scope.loading = false;
				alertify.dialog.alert(errorMessage);
			});

			$scope.$on("presentationPageRenderError", function(event, pageNumber, maxPageNumber, errorMessage) {
				$scope.loading = false;
				alertify.dialog.alert(errorMessage);
			});

			$scope.advertiseFile = function(file) {
				console.log("Advertising file", file);
				var fileInfo = file.info;
				// TODO(fancycode): other peers should either request the file or subscribe rendered images (e.g. for mobile app), for now we send the whole file
				mediaStream.webrtc.callForEachCall(function(peercall) {
					mediaStreamSendPresentation(peercall, currentToken, {
						Type: "FileInfo",
						FileInfo: fileInfo
					});
				});
				var presentation = uploadPresentation(file);
				if (!$scope.currentPresentation) {
					// no presentation active, show immediately
					$scope.selectPresentation(presentation);
				}
			};

			var filesSelected = function(files) {
				var valid_files = [];
				_.each(files, function(f) {
					if (!SUPPORTED_TYPES.hasOwnProperty(f.info.type)) {
						console.log("Not sharing file", f);
						alertify.dialog.alert(translation._("Only PDF documents and OpenDocument files can be shared at this time."));
						valid_files = null;
						return;
					}
					if (valid_files !== null) {
						valid_files.push(f);
					}
				});

				$scope.$apply(function(scope) {
					_.each(valid_files, function(f) {
						if (!f.info.hasOwnProperty("id")) {
							f.info.id = f.id;
						}
						scope.advertiseFile(f);
					});
				});
			};

			$scope.showPresentation = function() {
				console.log("Presentation active");
				$scope.layout.presentation = true;
				$scope.$emit("mainview", "presentation", true);

				if (currentToken) {
					mediaStream.tokens.off(currentToken, tokenHandler);
				}

				// Create token to register with us and send token out to all peers.
				// Peers when connect to us with the token and we answer.
				currentToken = "presentation_" + $scope.id + "_" + (presentationsCount++);

				// Create callbacks are called for each incoming connections.
				tokenHandler = mediaStream.tokens.create(currentToken, function(event, currenttoken, to, data, type, to2, from, peerpresentation) {
					console.log("Presentation create", currenttoken, data, type, peerpresentation);
					presentations.push(peerpresentation);
					//usermedia.addToPeerConnection(peerscreenshare.peerconnection);
				}, "presentation");

				// Connect all current calls.
				mediaStream.webrtc.callForEachCall(function(peercall) {
					connector(currentToken, peercall);
				});
				// Catch later calls too.
				mediaStream.webrtc.e.on("statechange", updater);
			};

			$scope.hidePresentation = function() {
				console.log("Presentation disabled");
				if (currentToken) {
					mediaStream.webrtc.callForEachCall(function(peercall) {
						mediaStreamSendPresentation(peercall, currentToken, {
							Type: "Hide",
							Hide: true
						});
					});
					mediaStream.tokens.off(currentToken, tokenHandler);
					currentToken = null;
				}
				$scope.resetProperties();
				$scope.layout.presentation = false;
				peers = {};
				$scope.$emit("mainview", "presentation", false);
				mediaStream.webrtc.e.off("statechange", updater);
			};

			$scope.selectPresentation = function(presentation) {
				if (!presentation.presentable) {
					// can't show this presentation
					return;
				}
				if ($scope.currentPresentation === presentation) {
					// switch back to first page when clicked on current presentation
					$scope.currentPageNumber = 1;
					return;
				}
				mediaStream.webrtc.callForEachCall(function(peercall) {
					mediaStreamSendPresentation(peercall, currentToken, {
						Type: "Select",
						Select: presentation.token
					});
				});
				$scope.doSelectPresentation(presentation);
			}

			$scope.doSelectPresentation = function(presentation) {
				console.log("Selected", presentation);
				$scope.resetProperties();
				$scope.currentPresentation = presentation;
			};

			$scope.deletePresentation = function(presentation, $event) {
				if ($event) {
					$event.preventDefault();
				}
				var pos = _.indexOf($scope.availablePresentations, presentation);
				if (pos !== -1) {
					$scope.availablePresentations.splice(pos, 1);
				}
				if (presentation.uploaded) {
					mediaStream.webrtc.callForEachCall(function(peercall) {
						mediaStreamSendPresentation(peercall, currentToken, {
							Type: "Delete",
							Delete: presentation.token
						});
					});
				}
				if ($scope.currentPresentation === presentation) {
					$scope.currentPresentation = null;
					$scope.resetProperties();
				}
				presentation.clear();
			};

			$scope.downloadPresentation = function(presentation, $event) {
				if ($event) {
					$event.preventDefault();
				}
				presentation.browserOpen();
			};

			$scope.prevPage = function() {
				if ($scope.currentPageNumber > 1) {
					$scope.currentPageNumber -= 1;
				}
			};

			$scope.nextPage = function() {
				if ($scope.currentPageNumber < $scope.maxPageNumber) {
					$scope.currentPageNumber += 1;
				}
			};

			mediaStream.webrtc.e.on("done", function() {
				$scope.$apply(function() {
					_.each($scope.availablePresentations, function(presentation) {
						presentation.clear();
					});
					$scope.availablePresentations = [];
					$scope.activeDownloads = [];
				});
			});

			$(document).on("keyup", function(event) {
				if (!$scope.layout.presentation) {
					return;
				}
				if ($(event.target).is("input,textarea,select")) {
					return;
				}
				$scope.$apply(function() {
					switch (event.keyCode) {
					case 37:
						// left arrow
						$scope.prevPage();
						event.preventDefault();
						break;
					case 39:
						// right arrow
					case 32:
						// space
						$scope.nextPage();
						event.preventDefault();
						break;
					}
				});
			});

			$($window).on("message", function(e) {
				var event = e.originalEvent;
				if (event.origin  !== $window.parent.location.origin) {
					return;
				}
				var data = event.data;
				var type = data && data.Type;
				switch(type) {
					case "presentationLoaded":
						console.log("pdf - presentationLoaded", event);
						presentationLoaded(data.NumPages);
						break;
					case "presentationLoadError":
						console.log("pdf - presentationLoadError", event);
						presentationLoadError(data.ErrorMessage);
						break;
					case "uploadPresentation":
						console.log("pdf - uploadPresentation", event);
						// Get new presentation token and file info and append to availablePresentations
						uploadPresentation(data.FileInfo);
						break;
					case "Selected":
						console.log("pdf - Selected", event);
						$scope.selectPresentation(availablePresentations[data.PresentationIndex]);
						break;
					case "presentationPageLoadError":
						break;
					case "presentationPageRenderError":
						break;
					default:
						console.log("pdf - Error incorrect message type");
						break;
				}
			});

/*			$scope.$watch("layout.presentation", function(newval, oldval) {
				if (newval && !oldval) {
					$scope.showPresentation();
				} else if (!newval && oldval) {
					$scope.hidePresentation();
				}
			});

			$scope.$watch("layout.main", function(newval, oldval) {
				if (newval && newval !== "presentation") {
					$scope.hidePresentation();
				}
			});
*/
		}];

		return {
			restrict: 'E',
			replace: false,
			scope: true,
			template: template,
			controller: controller
		};

	}];

});
