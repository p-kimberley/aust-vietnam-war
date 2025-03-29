/**
 * Creates a scrollable list of incident notes
 */
BM.angularApp.directive('incidentNoteList', ['BM.services.incidentNote', function (incidentNoteServices)
{
	return {
		template:
		'<div class="panel-section-content" ng-hide="notes.length > 0" ng-bind-html="emptyMessage"></div>' +
		'<ul class="incident-note-list">' +
		'<li data-note-id="{{incidentNote._id}}" class="notes-item" ng-repeat="incidentNote in notes" ng-class="incidentNoteServices.getNoteListItemClass(incidentNote._id)"' +
			' ng-click="incidentNoteServices.displayNote(incidentNote._id)">' +
		'<div class="incident-popup-notes-meta">' +
		'<div class="notes-title">{{incidentNote._source.Title ? incidentNote._source.Title : "(Untitled Note)"}}</div>' +
		'<div class="notes-body-preview">{{incidentNoteServices.getNoteBody(incidentNote._source.Body)}}</div>' +
		'<div class="notes-comment-count" title="Number of comments for this note">' +
			'<span class="fa fa-commenting-o"></span><span>{{incidentNoteServices.getCommentCount(incidentNote)}}</span>' +
		'</div>' +
		'<div class="notes-status" ng-class="incidentNoteServices.getNoteStatusClass(incidentNote._source.Approval_Status)" title="Approval status: {{incidentNoteServices.getNoteStatusClass(incidentNote._source.Approval_Status)}}"></div>' +
		'<div class="notes-author">{{incidentNoteServices.getCreationDate(incidentNote)}} by {{incidentNote._source.Author.Name}}</div>' +
		'</div>' +
		'</li>' +
		'</ul>'
	};
}]);